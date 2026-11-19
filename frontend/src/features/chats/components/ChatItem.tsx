import { CalendarX, Clock, Copy, Eye, GitMerge, Loader2, LockKeyhole, Mail, Trash2, ZapOff } from 'lucide-react'
import { TagChip } from '../../../shared/ui/TagChip'
import { Avatar } from '../../../shared/ui/Avatar'
import { useLeadStageCatalog } from '../../leads/public/useLeadStages'
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ConfirmDialog } from '../../../shared/ui/ConfirmDialog'
import { Tooltip } from '../../../shared/ui/Tooltip'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { useMe } from '../../auth/public/queries'
import { useDeleteLead, useMarkNoShow } from '../../leads/public/queries'
import type { Chat } from '../../leads/types'
import { displayName, formatElapsedShort, isAwaitingReply, isBotAttended, waitingTier } from '../../leads/public/chat'
import { parseContent, searchSnippet, splitOnMatch } from '../../whatsapp/public/message'
import { useChatDraft } from '../draftStore'
import { contactMatchReason } from '../searchMatch'
import { Highlighted } from './MessageSearchRow'

// Diálogos que solo se abren a pedido: fuera del bundle inicial.
const MergeLeadDialog = lazy(() => import('../../leads/public/MergeLeadDialog').then(m => ({ default: m.MergeLeadDialog })))

interface Props {
  chat: Chat
  isSelected: boolean
  isHighlighted: boolean
  /** Término de búsqueda activo: centra el preview en la coincidencia y la
   * resalta cuando el chat matcheó por un mensaje del historial. */
  search?: string
  /** En la sección "Contactos" del buscador: resalta lo buscado en el nombre
   * y, si el nombre no lo explica, dice por qué campo matcheó el lead. */
  showMatchReason?: boolean
  onClick: () => void
  onPreview: () => void
  onMarkUnread: () => void
  isMarkingUnread?: boolean
  /** Sin el aviso de vista rápida (en modo selección tocar la fila la marca). */
  hideHint?: boolean
}

const LONG_PRESS_MS = 450
const LONG_PRESS_MOVE_TOLERANCE_PX = 10

function formatTime(timestamp: string | null): string {
  if (!timestamp) return ''
  const d = new Date(timestamp)
  return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
}

// La espera va con icono de reloj además del color (doc 18 §5.3): el color
// solo no lo distingue quien no ve bien el rojo o el ámbar.
const TIER_TEXT_CLASS: Record<string, string> = {
  fresh: 'text-accent-strong',
  warning: 'text-warning-fg',
  urgent: 'text-danger-fg',
}

const TIER_TITLE: Record<string, string> = {
  fresh: 'Esperando respuesta',
  warning: 'Esperando respuesta hace un rato',
  urgent: 'Esperando respuesta hace bastante — se puede estar enfriando',
}

export function ChatItem({ chat, isSelected, isHighlighted, search = '', showMatchReason = false, onClick, onPreview, onMarkUnread, isMarkingUnread = false, hideHint = false }: Props) {
  const longPressTimerRef = useRef<number | null>(null)
  const suppressClickTimerRef = useRef<number | null>(null)
  const longPressStartRef = useRef({ x: 0, y: 0 })
  const suppressClickRef = useRef(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showMergeDialog, setShowMergeDialog] = useState(false)
  const navigate = useNavigate()
  const { chatId: openChatId } = useParams<{ chatId?: string }>()
  const { data: me } = useMe()
  const isAdmin = me?.role === 'admin'
  const { mutate: markNoShow, isPending: isMarkingNoShow } = useMarkNoShow(chat.chat_id)
  const { mutate: deleteLead, isPending: isDeleting } = useDeleteLead()

  function handleCopyPhone() {
    if (!chat.phone) return
    void navigator.clipboard.writeText(chat.phone).then(
      () => toast.success('Teléfono copiado'),
      () => toast.error('No se pudo copiar el teléfono'),
    )
  }

  function handleMarkNoShow() {
    if (isMarkingNoShow) return
    markNoShow(undefined, { onError: (err) => toast.error(extractErrorMessage(err)) })
  }

  function handleDelete() {
    deleteLead(chat.chat_id, {
      onSuccess: () => {
        toast.success(`${displayName(chat)} eliminado`)
        if (openChatId === chat.chat_id) navigate('/')
      },
      onError: (err) => toast.error(extractErrorMessage(err)),
    })
  }

  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('keydown', closeOnEscape)
    document.addEventListener('pointerdown', close)
    return () => {
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('keydown', closeOnEscape)
      document.removeEventListener('pointerdown', close)
    }
  }, [contextMenu])

  // El menú creció (copiar teléfono, no-show, fusionar, eliminar): con un
  // lead abierto cerca del borde inferior, la altura fija de antes dejaba
  // las últimas opciones tapadas por el borde de la ventana. Se mide el
  // tamaño real ya renderizado y se reubica antes del primer paint, así que
  // no se ve el salto.
  useLayoutEffect(() => {
    if (!contextMenu || !menuRef.current) return
    const rect = menuRef.current.getBoundingClientRect()
    const clampedX = Math.max(8, Math.min(contextMenu.x, window.innerWidth - rect.width - 8))
    const clampedY = Math.max(8, Math.min(contextMenu.y, window.innerHeight - rect.height - 8))
    if (clampedX !== contextMenu.x || clampedY !== contextMenu.y) {
      setContextMenu({ x: clampedX, y: clampedY })
    }
  }, [contextMenu])

  function cancelLongPress() {
    if (longPressTimerRef.current != null) window.clearTimeout(longPressTimerRef.current)
    longPressTimerRef.current = null
  }

  function clearClickSuppression() {
    if (suppressClickTimerRef.current != null) window.clearTimeout(suppressClickTimerRef.current)
    suppressClickTimerRef.current = null
    suppressClickRef.current = false
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    cancelLongPress()
    longPressStartRef.current = { x: event.clientX, y: event.clientY }
    longPressTimerRef.current = window.setTimeout(() => {
      suppressClickRef.current = true
      // Algunos navegadores móviles no emiten click después del long press.
      // El seguro caduca para no tragarse el siguiente toque normal.
      suppressClickTimerRef.current = window.setTimeout(clearClickSuppression, 1_000)
      onPreview()
      longPressTimerRef.current = null
    }, LONG_PRESS_MS)
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const movedX = Math.abs(event.clientX - longPressStartRef.current.x)
    const movedY = Math.abs(event.clientY - longPressStartRef.current.y)
    if (movedX > LONG_PRESS_MOVE_TOLERANCE_PX || movedY > LONG_PRESS_MOVE_TOLERANCE_PX) cancelLongPress()
  }

  useEffect(() => () => {
    cancelLongPress()
    clearClickSuppression()
  }, [])

  // Como WhatsApp: si el chat entró al resultado de búsqueda solo por un
  // mensaje del historial, el preview muestra ese mensaje y no el último.
  const isMessageMatch = chat.search_rank === 0 && !!chat.matched_message
  const preview = parseContent(
    isMessageMatch
      ? chat.matched_message!
      : { content: chat.last_message, message_type: chat.last_message_type, message_subtype: chat.last_message_subtype },
  )
  // De un mensaje eliminado el backend no manda el texto: el preview lo dice
  // en vez de quedar en "—", igual que la lista de chats de WhatsApp.
  const isDeletedPreview = !isMessageMatch && !!chat.last_message_deleted
  const Icon = isDeletedPreview ? null : preview.icon
  // El texto humano si lo hay; si no, la etiqueta del tipo ("Imagen",
  // "Ubicación"…) para que un adjunto sin caption no quede en "—".
  const rawPreviewText = isDeletedPreview
    ? 'Se eliminó este mensaje'
    : preview.text || (preview.kind !== 'text' ? preview.label : '—')
  // El término puede estar en el medio de un mensaje largo: el snippet lo
  // deja visible al inicio del preview y el split lo resalta en negrita.
  const previewText = isMessageMatch ? searchSnippet(rawPreviewText, search) : rawPreviewText
  const matchParts = isMessageMatch ? splitOnMatch(previewText, search) : null
  const matchReason = showMatchReason ? contactMatchReason(chat, search) : null
  // Como WhatsApp: un chat con texto a medio escribir lo avisa en la lista,
  // salvo el abierto (su borrador ya está a la vista en el compositor).
  const [draft] = useChatDraft(chat.chat_id)
  const draftPreview = !isSelected && !isMessageMatch ? draft.trim().split('\n')[0] : ''

  // El tiempo transcurrido se recalcula en cada render con Date.now(); no
  // hace falta un timer propio porque la lista ya refresca sola (websocket
  // + refetchInterval de useInfiniteChats), así que esto se actualiza solo.
  const awaitingReply = isAwaitingReply(chat)
  const elapsedMs = awaitingReply && chat.timestamp ? Date.now() - new Date(chat.timestamp).getTime() : 0
  const tier = waitingTier(elapsedMs)
  const customerWindowExpiresAt = chat.last_customer_message_at
    ? new Date(chat.last_customer_message_at).getTime() + 24 * 60 * 60 * 1000
    : 0
  const isCustomerWindowOpen = customerWindowExpiresAt > Date.now()
  const botAttended = isBotAttended(chat)
  const stageCatalog = useLeadStageCatalog()
  const stage = chat.stage ? stageCatalog.get(chat.stage) : null

  function openContextMenu(event: ReactMouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    cancelLongPress()
    // Posición cruda del clic: el efecto de arriba la corrige contra el
    // tamaño real del menú apenas se monta, antes de pintar.
    setContextMenu({ x: event.clientX, y: event.clientY })
  }

  return (
    <>
    <Tooltip content={hideHint ? null : "Mantén pulsado o usa clic derecho para vista rápida"} side="bottom">
    <button type="button"
      onClick={(event) => {
        if (suppressClickRef.current) {
          event.preventDefault()
          clearClickSuppression()
          return
        }
        onClick()
      }}
      onContextMenu={openContextMenu}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={cancelLongPress}
      onPointerCancel={cancelLongPress}
      onPointerLeave={cancelLongPress}
      onKeyDown={(event) => {
        if (event.shiftKey && event.key === 'Enter') {
          event.preventDefault()
          onPreview()
        }
      }}
      className={`mx-2 my-0.5 flex w-[calc(100%-1rem)] items-start gap-3 rounded-lg px-3 py-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
        isSelected
          ? 'bg-selected'
          : isHighlighted
            ? 'bg-warning-soft ring-1 ring-inset ring-warning'
            : 'hover:bg-subtle'
      }`}
    >
      {/* Tono estable por lead (no por nombre): no cambia al renombrarlo. */}
      <Avatar name={displayName(chat)} seed={chat.chat_id} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className={`truncate text-md text-fg ${chat.unread_count > 0 ? 'font-semibold' : 'font-medium'}`}>
            {showMatchReason ? <Highlighted text={displayName(chat)} search={search} /> : displayName(chat)}
          </span>
          {awaitingReply ? (
            <Tooltip content={`${TIER_TITLE[tier]}: ${formatElapsedShort(elapsedMs)}`} side="top">
            <span className={`flex shrink-0 items-center gap-1 text-xs font-semibold tabular-nums ${TIER_TEXT_CLASS[tier]}`}>
              <Clock className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
              {formatElapsedShort(elapsedMs)}
            </span>
            </Tooltip>
          ) : (
            <span className={`shrink-0 text-xs tabular-nums ${chat.unread_count > 0 ? 'font-semibold text-accent-strong' : 'text-fg-muted'}`}>
              {formatTime(chat.timestamp)}
            </span>
          )}
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <p className="flex min-w-0 items-center gap-1 truncate text-sm text-fg-muted">
            {!draftPreview && Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-fg-muted" />}
            {draftPreview ? (
              <span className="truncate">
                <span className="font-medium text-accent-strong">Borrador: </span>
                {draftPreview}
              </span>
            ) : matchParts ? (
              <span className="truncate">
                {matchParts[0]}
                <strong className="font-semibold text-fg">{matchParts[1]}</strong>
                {matchParts[2]}
              </span>
            ) : (
              <span className="truncate">{previewText}</span>
            )}
          </p>
          <span className="flex shrink-0 items-center gap-1.5">
            {chat.automatizacion_pausada && (
              <Tooltip content="Sin automatizaciones nuevas para este cliente" side="top">
              <span aria-label="Automatizaciones pausadas" className="text-warning-fg">
                <ZapOff className="h-3.5 w-3.5" />
              </span>
              </Tooltip>
            )}
            {!isCustomerWindowOpen && (
              <Tooltip content="Ventana de 24 horas cerrada" side="top">
              <span aria-label="Ventana de 24 horas cerrada" className="text-danger-fg">
                <LockKeyhole className="h-3.5 w-3.5" />
              </span>
              </Tooltip>
            )}
            {chat.unread_count > 0 && (
              <Tooltip content={botAttended ? 'Pendiente de lectura; un bot ya respondió' : 'Chat no leído'} side="top">
              {/* Punto + número, como WhatsApp (decisión 3 del doc 18). Si un
                  bot ya contestó, el número va en ámbar: no urge igual. */}
              <span
                aria-label={`${chat.unread_count} mensaje${chat.unread_count === 1 ? '' : 's'} sin leer`}
                className={`flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold tabular-nums ${
                  botAttended ? 'bg-warning-soft text-warning-fg' : 'bg-accent-fill text-on-accent'
                }`}
              >
                {chat.unread_count > 99 ? '99+' : chat.unread_count}
              </span>
              </Tooltip>
            )}
          </span>
        </div>
        {matchReason && (
          <p className="mt-0.5 truncate text-xs text-fg-muted">
            {matchReason.label}: <Highlighted text={matchReason.value} search={search} />
          </p>
        )}
        {/* Etapa, vendedora y etiquetas en una línea de 12 px: lo que antes
            obligaba a abrir el chat para saber en qué estaba. */}
        <div className="mt-1.5 flex min-w-0 items-center gap-1.5 overflow-hidden text-xs text-fg-muted">
          {stage && (
            <>
              <span className="flex shrink-0 items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: stage.color }} aria-hidden="true" />
                <span className="max-w-28 truncate">{stage.name}</span>
              </span>
              <span aria-hidden="true">·</span>
            </>
          )}
          <span className="max-w-24 shrink-0 truncate">{chat.vendedor ?? 'Sin asignar'}</span>
          {chat.tags.slice(0, 2).map((tag) => (
            <TagChip key={tag.id} name={tag.name} color={tag.color} className="max-w-24 shrink" />
          ))}
          {chat.tags.length > 2 && <span className="shrink-0">+{chat.tags.length - 2}</span>}
        </div>
      </div>
    </button>
    </Tooltip>
    {contextMenu && createPortal(
      <div
        ref={menuRef}
        role="menu"
        aria-label={`Acciones para ${displayName(chat)}`}
        style={{ left: contextMenu.x, top: contextMenu.y }}
        className="fixed z-[100] max-h-[calc(100vh-16px)] w-52 overflow-y-auto rounded-xl border border-wa-border bg-white p-1.5 shadow-2xl dark:border-wa-border-dark dark:bg-wa-head-dark"
        onPointerDown={event => event.stopPropagation()}
      >
        <button
          type="button"
          role="menuitem"
          onClick={() => { setContextMenu(null); onPreview() }}
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-wa-text hover:bg-wa-hover dark:text-wa-text-dark dark:hover:bg-wa-active-dark"
        >
          <Eye className="h-4 w-4 text-wa-muted dark:text-wa-muted-dark" /> Vista rápida
        </button>
        {chat.unread_count === 0 && chat.last_customer_message_at && (
          <button
            type="button"
            role="menuitem"
            disabled={isMarkingUnread}
            onClick={() => { setContextMenu(null); onMarkUnread() }}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-wa-text hover:bg-wa-hover disabled:opacity-50 dark:text-wa-text-dark dark:hover:bg-wa-active-dark"
          >
            {isMarkingUnread ? <Loader2 className="h-4 w-4 animate-spin text-wa-muted" /> : <Mail className="h-4 w-4 text-wa-muted dark:text-wa-muted-dark" />}
            Marcar como no leído
          </button>
        )}
        {chat.phone && (
          <button
            type="button"
            role="menuitem"
            onClick={() => { setContextMenu(null); handleCopyPhone() }}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-wa-text hover:bg-wa-hover dark:text-wa-text-dark dark:hover:bg-wa-active-dark"
          >
            <Copy className="h-4 w-4 text-wa-muted dark:text-wa-muted-dark" /> Copiar teléfono
          </button>
        )}
        {chat.proxima_cita && (
          <button
            type="button"
            role="menuitem"
            disabled={isMarkingNoShow}
            onClick={() => { setContextMenu(null); handleMarkNoShow() }}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-wa-text hover:bg-wa-hover disabled:opacity-50 dark:text-wa-text-dark dark:hover:bg-wa-active-dark"
          >
            {isMarkingNoShow ? <Loader2 className="h-4 w-4 animate-spin text-wa-muted" /> : <CalendarX className="h-4 w-4 text-wa-muted dark:text-wa-muted-dark" />}
            Marcar no-show
          </button>
        )}
        {isAdmin && (
          <>
            <div className="my-1.5 border-t border-wa-border dark:border-wa-border-dark" />
            <button
              type="button"
              role="menuitem"
              onClick={() => { setContextMenu(null); setShowMergeDialog(true) }}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-wa-text hover:bg-wa-hover dark:text-wa-text-dark dark:hover:bg-wa-active-dark"
            >
              <GitMerge className="h-4 w-4 text-wa-muted dark:text-wa-muted-dark" /> Fusionar con...
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={isDeleting}
              onClick={() => { setContextMenu(null); setShowDeleteConfirm(true) }}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950/40"
            >
              {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Eliminar lead
            </button>
          </>
        )}
      </div>,
      document.body,
    )}
    <ConfirmDialog
      open={showDeleteConfirm}
      onOpenChange={setShowDeleteConfirm}
      title="Eliminar lead"
      description={`Se borra ${displayName(chat)} junto con todo su historial de mensajes, tareas y notas. No se puede deshacer.`}
      confirmLabel="Eliminar"
      onConfirm={handleDelete}
    />
    <Suspense fallback={null}>
      {showMergeDialog && (
        <MergeLeadDialog chat={chat} onClose={() => setShowMergeDialog(false)} />
      )}
    </Suspense>
    </>
  )
}

import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import type { Chat } from '../types'
import { BotOff, CalendarX, Copy, Eye, GitMerge, Loader2, LockKeyhole, Mail, Trash2 } from 'lucide-react'
import { useMe } from '../hooks/useAuth'
import { useDeleteLead, useMarkNoShow } from '../hooks/useChats'
import { avatarInitial, displayName, formatElapsedShort, isAwaitingReply, isBotAttended, waitingTier } from '../utils/chat'
import { extractErrorMessage } from '../utils/errors'
import { parseContent, searchSnippet, splitOnMatch } from '../utils/message'
import { ConfirmDialog } from './ui/ConfirmDialog'
import { MergeLeadDialog } from './MergeLeadDialog'

interface Props {
  chat: Chat
  isSelected: boolean
  isHighlighted: boolean
  /** Término de búsqueda activo: centra el preview en la coincidencia y la
   * resalta cuando el chat matcheó por un mensaje del historial. */
  search?: string
  onClick: () => void
  onPreview: () => void
  onMarkUnread: () => void
  isMarkingUnread?: boolean
}

const LONG_PRESS_MS = 450
const LONG_PRESS_MOVE_TOLERANCE_PX = 10

function formatTime(timestamp: string | null): string {
  if (!timestamp) return ''
  const d = new Date(timestamp)
  return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
}

const TIER_TEXT_CLASS: Record<string, string> = {
  fresh: 'text-wa-primary-strong dark:text-wa-primary',
  warning: 'text-amber-700 dark:text-amber-400',
  urgent: 'text-red-700 dark:text-red-400',
}

const TIER_DOT_CLASS: Record<string, string> = {
  fresh: 'bg-wa-primary',
  warning: 'bg-amber-500',
  urgent: 'bg-red-500 animate-pulse',
}

const TIER_TITLE: Record<string, string> = {
  fresh: 'Esperando respuesta',
  warning: 'Esperando respuesta hace un rato',
  urgent: 'Esperando respuesta hace bastante — se puede estar enfriando',
}

export function ChatItem({ chat, isSelected, isHighlighted, search = '', onClick, onPreview, onMarkUnread, isMarkingUnread = false }: Props) {
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
      : { content: chat.last_message, message_type: chat.last_message_type },
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

  function openContextMenu(event: ReactMouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    cancelLongPress()
    // Posición cruda del clic: el efecto de arriba la corrige contra el
    // tamaño real del menú apenas se monta, antes de pintar.
    setContextMenu({ x: event.clientX, y: event.clientY })
  }

  return (
    <>
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
      title="Mantén pulsado o usa clic derecho para vista rápida"
      className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors duration-200 ${
        isSelected
          ? 'bg-wa-active dark:bg-wa-active-dark'
          : isHighlighted
            ? 'bg-amber-50 dark:bg-amber-900/40 ring-1 ring-inset ring-amber-400 dark:ring-amber-500'
            : 'hover:bg-wa-hover dark:hover:bg-wa-hover-dark'
      }`}
    >
      <div className="w-12 h-12 rounded-full bg-gradient-to-br from-wa-primary to-wa-primary-strong flex items-center justify-center text-white font-semibold text-base shrink-0">
        {avatarInitial(chat)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-baseline">
          <span
            className={`text-sm truncate text-wa-text dark:text-wa-text-dark ${
              chat.unread_count > 0 ? 'font-semibold' : 'font-medium'
            }`}
          >
            {displayName(chat)}
          </span>
          {awaitingReply ? (
            <span
              title={`${TIER_TITLE[tier]}: ${formatElapsedShort(elapsedMs)}`}
              className={`flex items-center gap-1 text-[11px] font-medium ml-2 shrink-0 ${TIER_TEXT_CLASS[tier]}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${TIER_DOT_CLASS[tier]}`} />
              {formatElapsedShort(elapsedMs)}
            </span>
          ) : (
            <span
              className={`text-[11px] ml-2 shrink-0 ${
                chat.unread_count > 0
                  ? 'font-medium text-wa-primary'
                  : 'text-wa-muted dark:text-wa-muted-dark'
              }`}
            >
              {formatTime(chat.timestamp)}
            </span>
          )}
        </div>
        <div className="flex items-baseline justify-between gap-2 mt-0.5">
          <p className="text-[13px] text-wa-muted dark:text-wa-muted-dark truncate flex items-center gap-1 min-w-0">
            {Icon && <Icon className="w-3.5 h-3.5 text-wa-muted dark:text-wa-muted-dark shrink-0" />}
            {matchParts ? (
              <span className="truncate">
                {matchParts[0]}
                <strong className="font-semibold text-wa-text dark:text-wa-text-dark">{matchParts[1]}</strong>
                {matchParts[2]}
              </span>
            ) : (
              <span className="truncate">{previewText}</span>
            )}
          </p>
          {chat.automatizacion_pausada && (
            <span title="Automatización pausada en este chat" className="shrink-0 text-amber-500 dark:text-amber-400">
              <BotOff className="h-3.5 w-3.5" />
            </span>
          )}
          {!isCustomerWindowOpen && (
            <span title="Ventana de 24 horas cerrada" className="shrink-0 text-red-500 dark:text-red-400">
              <LockKeyhole className="h-3.5 w-3.5" />
            </span>
          )}
          {chat.unread_count > 0 && (
            <span
              title={botAttended ? 'Pendiente de lectura; un bot ya respondió' : 'Chat no leído'}
              aria-label={`${chat.unread_count} mensaje${chat.unread_count === 1 ? '' : 's'} sin leer`}
              className={`shrink-0 min-w-5 h-5 px-1.5 rounded-full text-white text-[11px] font-semibold flex items-center justify-center ${
                botAttended ? 'bg-amber-500 dark:bg-amber-600' : 'bg-wa-primary'
              }`}
            >
              {chat.unread_count > 99 ? '99+' : chat.unread_count}
            </span>
          )}
        </div>
        {chat.tags.length > 0 && (
          <div className="mt-1 flex gap-1 overflow-hidden">
            {chat.tags.slice(0, 2).map((tag) => (
              <span
                key={tag.id}
                className="max-w-24 truncate rounded-full px-1.5 py-0.5 text-[10px] font-medium text-white"
                style={{ backgroundColor: tag.color }}
              >
                {tag.name}
              </span>
            ))}
            {chat.tags.length > 2 && (
              <span className="text-[10px] text-wa-muted dark:text-wa-muted-dark">+{chat.tags.length - 2}</span>
            )}
          </div>
        )}
      </div>
    </button>
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
    {showMergeDialog && (
      <MergeLeadDialog chat={chat} onClose={() => setShowMergeDialog(false)} />
    )}
    </>
  )
}

import { Clock, LockKeyhole, ZapOff } from 'lucide-react'
import { Avatar } from '../../../shared/ui/Avatar'
import { useState, type MouseEvent as ReactMouseEvent } from 'react'
import { Tooltip } from '../../../shared/ui/Tooltip'
import type { Chat } from '../../leads/types'
import { displayName, formatElapsedShort, isAwaitingReply, isBotAttended, waitingTier } from '../../leads/public/chat'
import { parseContent, searchSnippet, splitOnMatch } from '../../whatsapp/public/message'
import { useChatDraft } from '../draftStore'
import { useLongPress } from '../hooks/useLongPress'
import { contactMatchReason } from '../searchMatch'
import { ChatItemMenu, type MenuPosition } from './ChatItemMenu'
import { ChatItemMeta } from './ChatItemMeta'
import { Highlighted } from './MessageSearchRow'

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
  const [contextMenu, setContextMenu] = useState<MenuPosition | null>(null)
  const longPress = useLongPress(onPreview)

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

  function openContextMenu(event: ReactMouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    longPress.cancel()
    // Posición cruda del clic: el menú la corrige contra su tamaño real
    // apenas se monta, antes de pintar.
    setContextMenu({ x: event.clientX, y: event.clientY })
  }

  return (
    <>
    <Tooltip content={hideHint ? null : "Mantén pulsado o usa clic derecho para vista rápida"} side="bottom">
    <button type="button"
      onClick={(event) => {
        if (longPress.consumeSuppressedClick(event)) return
        onClick()
      }}
      onContextMenu={openContextMenu}
      {...longPress.handlers}
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
        <ChatItemMeta chat={chat} />
      </div>
    </button>
    </Tooltip>
    <ChatItemMenu
      chat={chat}
      position={contextMenu}
      onPositionChange={setContextMenu}
      onPreview={onPreview}
      onMarkUnread={onMarkUnread}
      isMarkingUnread={isMarkingUnread}
    />
    </>
  )
}

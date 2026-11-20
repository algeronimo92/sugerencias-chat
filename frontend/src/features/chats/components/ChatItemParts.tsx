import { Clock, LockKeyhole, ZapOff } from 'lucide-react'
import { Tooltip } from '../../../shared/ui/Tooltip'
import type { Chat } from '../../leads/types'
import { formatElapsedShort, isAwaitingReply, isBotAttended, waitingTier } from '../../leads/public/chat'
import { parseContent, searchSnippet, splitOnMatch } from '../../whatsapp/public/message'
import { useChatDraft } from '../draftStore'

const DAY_MS = 24 * 60 * 60 * 1000

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

/** Hora del último mensaje o, si el cliente espera respuesta, cuánto lleva
 * esperando. */
export function ChatItemTime({ chat }: { chat: Chat }) {
  // El tiempo transcurrido se recalcula en cada render con Date.now(); no
  // hace falta un timer propio porque la lista ya refresca sola (websocket
  // + refetchInterval de useInfiniteChats), así que esto se actualiza solo.
  if (!isAwaitingReply(chat)) {
    return (
      <span className={`shrink-0 text-xs tabular-nums ${chat.unread_count > 0 ? 'font-semibold text-accent-strong' : 'text-fg-muted'}`}>
        {formatTime(chat.timestamp)}
      </span>
    )
  }
  const elapsedMs = chat.timestamp ? Date.now() - new Date(chat.timestamp).getTime() : 0
  const tier = waitingTier(elapsedMs)
  return (
    <Tooltip content={`${TIER_TITLE[tier]}: ${formatElapsedShort(elapsedMs)}`} side="top">
      <span className={`flex shrink-0 items-center gap-1 text-xs font-semibold tabular-nums ${TIER_TEXT_CLASS[tier]}`}>
        <Clock className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
        {formatElapsedShort(elapsedMs)}
      </span>
    </Tooltip>
  )
}

/** Texto que muestra la fila debajo del nombre. */
function previewContent(chat: Chat, search: string) {
  // Como WhatsApp: si el chat entró al resultado de búsqueda solo por un
  // mensaje del historial, el preview muestra ese mensaje y no el último.
  const matchedMessage = chat.search_rank === 0 ? chat.matched_message : null
  if (matchedMessage) {
    const preview = parseContent(matchedMessage)
    const rawText = preview.text || (preview.kind !== 'text' ? preview.label : '—')
    // El término puede estar en el medio de un mensaje largo: el snippet lo
    // deja visible al inicio del preview y el split lo resalta en negrita.
    const text = searchSnippet(rawText, search)
    return { isMessageMatch: true, Icon: preview.icon, text, matchParts: splitOnMatch(text, search) }
  }
  // De un mensaje eliminado el backend no manda el texto: el preview lo dice
  // en vez de quedar en "—", igual que la lista de chats de WhatsApp.
  if (chat.last_message_deleted) {
    return { isMessageMatch: false, Icon: null, text: 'Se eliminó este mensaje', matchParts: null }
  }
  const preview = parseContent({ content: chat.last_message, message_type: chat.last_message_type, message_subtype: chat.last_message_subtype })
  // El texto humano si lo hay; si no, la etiqueta del tipo ("Imagen",
  // "Ubicación"…) para que un adjunto sin caption no quede en "—".
  const text = preview.text || (preview.kind !== 'text' ? preview.label : '—')
  return { isMessageMatch: false, Icon: preview.icon, text, matchParts: null }
}

/** Línea de vista previa: el borrador si lo hay, la coincidencia de la
 * búsqueda o el último mensaje. */
export function ChatItemPreview({ chat, search, isSelected }: { chat: Chat; search: string; isSelected: boolean }) {
  const { isMessageMatch, Icon, text, matchParts } = previewContent(chat, search)
  // Como WhatsApp: un chat con texto a medio escribir lo avisa en la lista,
  // salvo el abierto (su borrador ya está a la vista en el compositor).
  const [draft] = useChatDraft(chat.chat_id)
  const draftPreview = !isSelected && !isMessageMatch ? draft.trim().split('\n')[0] : ''

  if (draftPreview) {
    return (
      <p className="flex min-w-0 items-center gap-1 truncate text-sm text-fg-muted">
        <span className="truncate">
          <span className="font-medium text-accent-strong">Borrador: </span>
          {draftPreview}
        </span>
      </p>
    )
  }
  return (
    <p className="flex min-w-0 items-center gap-1 truncate text-sm text-fg-muted">
      {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-fg-muted" />}
      {matchParts ? (
        <span className="truncate">
          {matchParts[0]}
          <strong className="font-semibold text-fg">{matchParts[1]}</strong>
          {matchParts[2]}
        </span>
      ) : (
        <span className="truncate">{text}</span>
      )}
    </p>
  )
}

/** Indicadores a la derecha de la vista previa: automatizaciones pausadas,
 * ventana de 24 h cerrada y mensajes sin leer. */
export function ChatItemBadges({ chat }: { chat: Chat }) {
  const isCustomerWindowOpen = !!chat.last_customer_message_at
    && new Date(chat.last_customer_message_at).getTime() + DAY_MS > Date.now()
  const botAttended = isBotAttended(chat)

  return (
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
  )
}

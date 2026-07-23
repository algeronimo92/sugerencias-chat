import type { Chat } from '../types'
import { LockKeyhole } from 'lucide-react'
import { avatarInitial, displayName, formatElapsedShort, isAwaitingReply, waitingTier } from '../utils/chat'
import { parseContent, searchSnippet, splitOnMatch } from '../utils/message'

interface Props {
  chat: Chat
  isSelected: boolean
  isHighlighted: boolean
  /** Término de búsqueda activo: centra el preview en la coincidencia y la
   * resalta cuando el chat matcheó por un mensaje del historial. */
  search?: string
  onClick: () => void
}

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

export function ChatItem({ chat, isSelected, isHighlighted, search = '', onClick }: Props) {
  // Como WhatsApp: si el chat entró al resultado de búsqueda solo por un
  // mensaje del historial, el preview muestra ese mensaje y no el último.
  const isMessageMatch = chat.search_rank === 0 && !!chat.matched_message
  const preview = parseContent(isMessageMatch ? chat.matched_message! : chat.last_message)
  const Icon = preview.icon
  const rawPreviewText = preview.kind === 'location' ? preview.label : preview.text || '—'
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

  return (
    <button
      onClick={onClick}
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
          {!isCustomerWindowOpen && (
            <span title="Ventana de 24 horas cerrada" className="shrink-0 text-red-500 dark:text-red-400">
              <LockKeyhole className="h-3.5 w-3.5" />
            </span>
          )}
          {chat.unread_count > 0 && (
            <span className="shrink-0 min-w-5 h-5 px-1.5 rounded-full bg-wa-primary text-white text-[11px] font-semibold flex items-center justify-center">
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
  )
}

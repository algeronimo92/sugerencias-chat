import type { Chat } from '../types'
import { avatarInitial, displayName, formatElapsedShort, isAwaitingReply, waitingTier } from '../utils/chat'
import { parseContent } from '../utils/message'

interface Props {
  chat: Chat
  isSelected: boolean
  isHighlighted: boolean
  onClick: () => void
}

function formatTime(timestamp: string | null): string {
  if (!timestamp) return ''
  const d = new Date(timestamp)
  return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
}

const TIER_TEXT_CLASS: Record<string, string> = {
  fresh: 'text-green-700 dark:text-green-500',
  warning: 'text-amber-700 dark:text-amber-400',
  urgent: 'text-red-700 dark:text-red-400',
}

const TIER_DOT_CLASS: Record<string, string> = {
  fresh: 'bg-green-500',
  warning: 'bg-amber-500',
  urgent: 'bg-red-500 animate-pulse',
}

const TIER_TITLE: Record<string, string> = {
  fresh: 'Esperando respuesta',
  warning: 'Esperando respuesta hace un rato',
  urgent: 'Esperando respuesta hace bastante — se puede estar enfriando',
}

export function ChatItem({ chat, isSelected, isHighlighted, onClick }: Props) {
  const preview = parseContent(chat.last_message)
  const Icon = preview.icon
  const previewText = preview.kind === 'location' ? preview.label : preview.text || '—'

  // El tiempo transcurrido se recalcula en cada render con Date.now(); no
  // hace falta un timer propio porque la lista ya refresca sola (websocket
  // + refetchInterval de useInfiniteChats), así que esto se actualiza solo.
  const awaitingReply = isAwaitingReply(chat)
  const elapsedMs = awaitingReply && chat.timestamp ? Date.now() - new Date(chat.timestamp).getTime() : 0
  const tier = waitingTier(elapsedMs)

  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-all duration-700 border-l-2 ${
        isSelected
          ? 'bg-green-50 dark:bg-green-950/40 border-green-600'
          : isHighlighted
            ? 'bg-amber-50 dark:bg-amber-900/40 border-transparent ring-1 ring-inset ring-amber-400 dark:ring-amber-500'
            : 'border-transparent hover:bg-gray-50 dark:hover:bg-gray-800/60'
      }`}
    >
      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-green-500 to-green-600 flex items-center justify-center text-white font-semibold text-sm shrink-0">
        {avatarInitial(chat)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-baseline">
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
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
            <span className="text-[11px] text-gray-400 dark:text-gray-500 ml-2 shrink-0">
              {formatTime(chat.timestamp)}
            </span>
          )}
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5 flex items-center gap-1">
          {Icon && <Icon className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 shrink-0" />}
          <span className="truncate">{previewText}</span>
        </p>
      </div>
    </button>
  )
}

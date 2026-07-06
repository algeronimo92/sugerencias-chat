import type { Chat } from '../types'
import { avatarInitial, displayName } from '../utils/chat'
import { parseContent } from '../utils/message'

interface Props {
  chat: Chat
  isSelected: boolean
  onClick: () => void
}

function formatTime(timestamp: string | null): string {
  if (!timestamp) return ''
  const d = new Date(timestamp)
  return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
}

export function ChatItem({ chat, isSelected, onClick }: Props) {
  const preview = parseContent(chat.last_message)
  const Icon = preview.icon

  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors border-l-2 ${
        isSelected ? 'bg-green-50 border-green-600' : 'border-transparent hover:bg-gray-50'
      }`}
    >
      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-green-500 to-green-600 flex items-center justify-center text-white font-semibold text-sm shrink-0">
        {avatarInitial(chat)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-baseline">
          <span className="text-sm font-medium text-gray-900 truncate">
            {displayName(chat)}
          </span>
          <span className="text-[11px] text-gray-400 ml-2 shrink-0">
            {formatTime(chat.timestamp)}
          </span>
        </div>
        <p className="text-xs text-gray-500 truncate mt-0.5 flex items-center gap-1">
          {Icon && <Icon className="w-3.5 h-3.5 text-gray-400 shrink-0" />}
          <span className="truncate">{preview.text || '—'}</span>
        </p>
      </div>
    </button>
  )
}

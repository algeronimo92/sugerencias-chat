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

  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-100 ${
        isSelected ? 'bg-green-50 border-l-4 border-green-500' : 'border-l-4 border-transparent'
      }`}
    >
      <div className="w-10 h-10 rounded-full bg-green-500 flex items-center justify-center text-white font-bold text-sm shrink-0">
        {avatarInitial(chat)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-baseline">
          <span className="text-sm font-semibold text-gray-900 truncate">
            {displayName(chat)}
          </span>
          <span className="text-xs text-gray-400 ml-2 shrink-0">
            {formatTime(chat.timestamp)}
          </span>
        </div>
        <p className="text-xs text-gray-500 truncate mt-0.5">
          {preview.kind !== 'text' && (
            <span className="text-gray-600 font-medium">
              {preview.icon} {preview.label}:{' '}
            </span>
          )}
          {preview.text || '—'}
        </p>
      </div>
    </button>
  )
}

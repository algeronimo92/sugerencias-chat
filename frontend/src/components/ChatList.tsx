import { useState } from 'react'
import type { Chat } from '../types'
import { ChatItem } from './ChatItem'
import { useChats } from '../hooks/useChats'
import { displayPhone } from '../utils/chat'

interface Props {
  selectedId: string | null
  onSelect: (chat: Chat) => void
}

export function ChatList({ selectedId, onSelect }: Props) {
  const { data: chats, isLoading, error, refetch } = useChats()
  const [search, setSearch] = useState('')

  const filtered = (chats ?? []).filter((c) => {
    const q = search.toLowerCase()
    return (
      displayPhone(c).toLowerCase().includes(q) ||
      (c.name?.toLowerCase().includes(q) ?? false) ||
      (c.last_message?.toLowerCase().includes(q) ?? false)
    )
  })

  return (
    <div className="flex flex-col h-full bg-white border-r border-gray-200">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-lg font-bold text-gray-900">Chats</h1>
          <button
            onClick={() => refetch()}
            className="text-xs text-green-600 hover:text-green-700 font-medium"
          >
            Actualizar
          </button>
        </div>
        <input
          type="text"
          placeholder="Buscar chat..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full text-sm bg-gray-100 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-green-400"
        />
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <p className="text-sm text-gray-400 text-center py-8">Cargando chats...</p>
        )}
        {error && (
          <p className="text-sm text-red-500 text-center py-8">
            Error al cargar chats.
          </p>
        )}
        {filtered.map((chat) => (
          <ChatItem
            key={chat.chat_id}
            chat={chat}
            isSelected={chat.chat_id === selectedId}
            onClick={() => onSelect(chat)}
          />
        ))}
        {!isLoading && filtered.length === 0 && !error && (
          <p className="text-sm text-gray-400 text-center py-8">Sin resultados.</p>
        )}
      </div>
    </div>
  )
}

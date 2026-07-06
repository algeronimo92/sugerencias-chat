import { useState } from 'react'
import { RefreshCw, Search } from 'lucide-react'
import type { Chat } from '../types'
import { ChatItem } from './ChatItem'

interface Props {
  chats: Chat[]
  isLoading: boolean
  error: boolean
  search: string
  onSearchChange: (value: string) => void
  onRefresh: () => Promise<unknown>
  selectedId: string | null
  onSelect: (chat: Chat) => void
}

export function ChatList({
  chats,
  isLoading,
  error,
  search,
  onSearchChange,
  onRefresh,
  selectedId,
  onSelect,
}: Props) {
  const [isManualRefreshing, setIsManualRefreshing] = useState(false)

  async function handleRefresh() {
    setIsManualRefreshing(true)
    try {
      await onRefresh()
    } finally {
      setIsManualRefreshing(false)
    }
  }

  return (
    <div className="flex flex-col h-full bg-white border-r border-gray-200">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-sm font-semibold text-gray-900">Leads</h1>
          <button
            onClick={handleRefresh}
            disabled={isManualRefreshing}
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-green-600 font-medium transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isManualRefreshing ? 'animate-spin' : ''}`} />
            Actualizar
          </button>
        </div>
        <div className="relative">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Buscar lead..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full text-sm bg-gray-50 border border-gray-200 rounded-lg pl-9 pr-3 py-2 outline-none focus:ring-2 focus:ring-green-400 focus:border-transparent"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <p className="text-sm text-gray-400 text-center py-8">Cargando leads...</p>
        )}
        {error && (
          <p className="text-sm text-red-500 text-center py-8">
            Error al cargar leads.
          </p>
        )}
        {chats.map((chat) => (
          <ChatItem
            key={chat.chat_id}
            chat={chat}
            isSelected={chat.chat_id === selectedId}
            onClick={() => onSelect(chat)}
          />
        ))}
        {!isLoading && chats.length === 0 && !error && (
          <p className="text-sm text-gray-400 text-center py-8">Sin resultados.</p>
        )}
      </div>
    </div>
  )
}

import { useEffect, useRef } from 'react'
import { RefreshCw } from 'lucide-react'
import type { Chat } from '../types'
import { useMessages } from '../hooks/useMessages'
import { avatarInitial, displayName } from '../utils/chat'
import { formatMessageTime, parseContent } from '../utils/message'

interface Props {
  chat: Chat
  onRefreshSuggestions: () => void
}

export function ChatThread({ chat, onRefreshSuggestions }: Props) {
  const { data: messages, isLoading, error, refetch, isFetching } = useMessages(chat.chat_id)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages])

  function handleRefresh() {
    refetch()
    onRefreshSuggestions()
  }

  return (
    <div className="flex flex-col h-full bg-slate-50">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 bg-white flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-green-500 to-green-600 flex items-center justify-center text-white font-semibold text-xs shrink-0">
            {avatarInitial(chat)}
          </div>
          <p className="text-sm font-semibold text-gray-900">{displayName(chat)}</p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={isFetching}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-green-600 font-medium transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />
          {isFetching ? 'Actualizando...' : 'Actualizar'}
        </button>
      </div>

      {/* Thread */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
        {isLoading && (
          <p className="text-sm text-gray-400 text-center py-8">Cargando mensajes...</p>
        )}
        {error && (
          <p className="text-sm text-red-500 text-center py-8">Error al cargar mensajes.</p>
        )}
        {!isLoading && !error && messages?.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-8">Sin mensajes en este chat.</p>
        )}
        {messages?.map((m) => {
          const isVendedor = m.sender === 'vendedor'
          const { kind, icon: Icon, label, text } = parseContent(m.content)
          return (
            <div key={m.id} className={`flex ${isVendedor ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[75%] rounded-2xl px-3.5 py-2.5 text-sm shadow-sm border ${
                  isVendedor
                    ? 'bg-green-100 border-green-200 text-gray-800 rounded-tr-sm'
                    : 'bg-white border-gray-200 text-gray-800 rounded-tl-sm'
                }`}
              >
                {kind !== 'text' && Icon && (
                  <div className="inline-flex items-center gap-1 bg-black/5 rounded px-1.5 py-0.5 mb-1 text-[11px] font-medium text-gray-600 uppercase tracking-wide">
                    <Icon className="w-3 h-3" />
                    <span>{label}</span>
                  </div>
                )}
                <p className={`whitespace-pre-wrap ${kind !== 'text' ? 'italic text-gray-600' : ''}`}>
                  {text || <span className="italic text-gray-400">Sin contenido</span>}
                </p>
                <div className="text-[10px] text-gray-400 text-right mt-1">
                  {formatMessageTime(m.sent_at)}
                </div>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}

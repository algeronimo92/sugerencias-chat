import { useEffect, useRef } from 'react'
import type { Chat } from '../types'
import { useMessages } from '../hooks/useMessages'
import { displayName } from '../utils/chat'
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
    <div className="flex flex-col h-full bg-[#e5ddd5]">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 bg-white flex items-center justify-between">
        <p className="font-semibold text-gray-900">{displayName(chat)}</p>
        <button
          onClick={handleRefresh}
          disabled={isFetching}
          className="text-xs text-green-600 hover:text-green-700 font-medium disabled:opacity-50"
        >
          {isFetching ? 'Actualizando...' : 'Actualizar'}
        </button>
      </div>

      {/* Thread */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        {isLoading && (
          <p className="text-sm text-gray-500 text-center py-8">Cargando mensajes...</p>
        )}
        {error && (
          <p className="text-sm text-red-500 text-center py-8">Error al cargar mensajes.</p>
        )}
        {!isLoading && !error && messages?.length === 0 && (
          <p className="text-sm text-gray-500 text-center py-8">Sin mensajes en este chat.</p>
        )}
        {messages?.map((m) => {
          const isVendedor = m.sender === 'vendedor'
          const { kind, icon, label, text } = parseContent(m.content)
          return (
            <div key={m.id} className={`flex ${isVendedor ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[75%] rounded-lg px-3 py-2 text-sm shadow-md ${
                  isVendedor
                    ? 'bg-green-100 text-gray-800 rounded-tr-none'
                    : 'bg-white text-gray-800 rounded-tl-none'
                }`}
              >
                {kind !== 'text' && (
                  <div className="inline-flex items-center gap-1 bg-black/5 rounded px-1.5 py-0.5 mb-1 text-[11px] font-medium text-gray-600 uppercase tracking-wide">
                    <span>{icon}</span>
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

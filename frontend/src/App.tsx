import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MessagesSquare, Sparkles } from 'lucide-react'
import type { Chat, SuggestionResponse } from './types'
import { ChatList } from './components/ChatList'
import { ChatThread } from './components/ChatThread'
import { SuggestionPanel } from './components/SuggestionPanel'
import { useSuggestions } from './hooks/useSuggestions'

const queryClient = new QueryClient()

function MainLayout() {
  const [selectedChat, setSelectedChat] = useState<Chat | null>(null)
  const [suggestionData, setSuggestionData] = useState<SuggestionResponse | null>(null)
  const [apiError, setApiError] = useState<string | null>(null)

  const { mutate, isPending } = useSuggestions()

  function requestSuggestions(chat: Chat) {
    setSuggestionData(null)
    setApiError(null)

    mutate(
      { chat_id: chat.chat_id, phone: chat.phone },
      {
        onSuccess: (data) => setSuggestionData(data),
        onError: (err: unknown) => {
          const msg = err instanceof Error ? err.message : 'Error desconocido'
          setApiError(msg)
        },
      }
    )
  }

  function handleSelectChat(chat: Chat) {
    setSelectedChat(chat)
    requestSuggestions(chat)
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-gray-100">
      {/* Barra superior */}
      <div className="h-12 shrink-0 bg-white border-b border-gray-200 flex items-center px-4 gap-2">
        <div className="w-6 h-6 rounded-md bg-green-600 flex items-center justify-center">
          <MessagesSquare className="w-3.5 h-3.5 text-white" />
        </div>
        <span className="text-sm font-semibold text-gray-900">WSP Suggestions</span>
        <span className="text-xs text-gray-400 ml-1">· DermicaPro · Panel de leads</span>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Panel izquierdo — Lista de chats */}
        <div className="w-80 shrink-0 h-full overflow-hidden">
          <ChatList
            selectedId={selectedChat?.chat_id ?? null}
            onSelect={handleSelectChat}
          />
        </div>

        {/* Panel central — Conversación */}
        <div className="flex-1 h-full overflow-hidden">
          {selectedChat ? (
            <ChatThread chat={selectedChat} onRefreshSuggestions={() => requestSuggestions(selectedChat)} />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-gray-300 gap-3 bg-slate-50">
              <MessagesSquare className="w-12 h-12" strokeWidth={1.5} />
              <p className="text-sm text-gray-400">Selecciona un lead para ver la conversación</p>
            </div>
          )}
        </div>

        {/* Panel derecho — Sugerencias */}
        <div className="w-96 shrink-0 h-full overflow-hidden bg-gray-50 border-l border-gray-200">
          {selectedChat ? (
            <SuggestionPanel
              chat={selectedChat}
              data={suggestionData}
              isLoading={isPending}
              error={apiError}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-gray-300 gap-3">
              <Sparkles className="w-12 h-12" strokeWidth={1.5} />
              <p className="text-sm text-gray-400 text-center px-6">Selecciona un lead para ver las sugerencias</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <MainLayout />
    </QueryClientProvider>
  )
}

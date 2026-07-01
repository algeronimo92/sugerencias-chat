import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
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
    <div className="flex h-screen overflow-hidden bg-gray-100">
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
          <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-3 bg-gray-50">
            <span className="text-5xl">💬</span>
            <p className="text-base">Selecciona un chat para ver la conversación</p>
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
          <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-3">
            <span className="text-5xl">✨</span>
            <p className="text-base text-center px-4">Selecciona un chat para ver las sugerencias</p>
          </div>
        )}
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

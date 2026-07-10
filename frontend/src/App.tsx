import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, useNavigate, useParams } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { Loader2, LogOut, MessagesSquare, Settings as SettingsIcon, Sparkles, Moon, Sun } from 'lucide-react'
import type { Chat, SuggestionResponse } from './types'
import { ChatList } from './components/ChatList'
import { ChatThread } from './components/ChatThread'
import { LoginPage } from './components/LoginPage'
import { SettingsDialog } from './components/SettingsDialog'
import { SuggestionPanel } from './components/SuggestionPanel'
import { useLogout, useMe } from './hooks/useAuth'
import { useChats, useChatUpdates, useInfiniteChats } from './hooks/useChats'
import { useSuggestions } from './hooks/useSuggestions'
import { useTheme } from './hooks/useTheme'
import { queryClient } from './queryClient'

function MainLayout() {
  const { data: me } = useMe()
  const { mutate: logout } = useLogout()
  const { chatId } = useParams<{ chatId: string }>()
  const navigate = useNavigate()

  const { theme, toggleTheme } = useTheme()
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)

  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(timeout)
  }, [search])

  useChatUpdates()

  const {
    data,
    isLoading,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
  } = useInfiniteChats(debouncedSearch)
  const chats = data?.pages.flatMap((page) => page.items) ?? []

  function handleLoadMore() {
    if (hasNextPage && !isFetchingNextPage) return fetchNextPage()
  }

  // Consulta aparte para resolver el chat seleccionado por su chat_id,
  // independiente del texto de búsqueda de la lista (si no, buscar algo
  // que no matchee el chat abierto lo "cerraría" solo).
  const { data: selectedChatResult } = useChats(chatId ?? '', { enabled: !!chatId })
  const selectedChat = chatId ? (selectedChatResult?.find((c) => c.chat_id === chatId) ?? null) : null

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

  // Dispara la consulta de sugerencias cuando cambia el chat seleccionado
  // (por click en la lista o por cargar la URL directamente).
  useEffect(() => {
    if (selectedChat) {
      requestSuggestions(selectedChat)
    } else {
      setSuggestionData(null)
      setApiError(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChat?.chat_id])

  function handleSelectChat(chat: Chat) {
    navigate(`/chat/${chat.chat_id}`)
  }

  function handleCloseChat() {
    navigate('/')
  }

  // Escape cierra el lead abierto, igual que WhatsApp
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && selectedChat) {
        handleCloseChat()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChat?.chat_id])

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-gray-100 dark:bg-gray-950">
      {/* Barra superior */}
      <div className="h-12 shrink-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 flex items-center px-4 gap-2">
        <div className="w-6 h-6 rounded-md bg-green-600 flex items-center justify-center">
          <MessagesSquare className="w-3.5 h-3.5 text-white" />
        </div>
        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">DermicaPro</span>
        <span className="text-xs text-gray-400 dark:text-gray-500 ml-1">- Panel de leads</span>
        <span className="flex-1" />
        {me && (
          <span className="text-xs text-gray-400 dark:text-gray-500 hidden sm:inline">
            {me.name} <span className="opacity-60">({me.role === 'admin' ? 'admin' : 'vendedor'})</span>
          </span>
        )}
        {me?.role === 'admin' && (
          <button
            onClick={() => setIsSettingsOpen(true)}
            aria-label="Configuración"
            title="Configuración"
            className="flex items-center justify-center w-7 h-7 rounded-md text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
          >
            <SettingsIcon className="w-4 h-4" />
          </button>
        )}
        <button
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Activar modo claro' : 'Activar modo oscuro'}
          className="flex items-center justify-center w-7 h-7 rounded-md text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
        >
          {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
        <button
          onClick={() => logout()}
          aria-label="Cerrar sesión"
          title="Cerrar sesión"
          className="flex items-center justify-center w-7 h-7 rounded-md text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>

      {isSettingsOpen && <SettingsDialog onClose={() => setIsSettingsOpen(false)} />}

      <div className="flex flex-1 overflow-hidden">
        {/* Panel izquierdo — Lista de chats */}
        <div className="w-80 shrink-0 h-full overflow-hidden">
          <ChatList
            chats={chats}
            isLoading={isLoading}
            error={!!error}
            search={search}
            onSearchChange={setSearch}
            onRefresh={refetch}
            selectedId={selectedChat?.chat_id ?? null}
            onSelect={handleSelectChat}
            hasNextPage={!!hasNextPage}
            isFetchingNextPage={isFetchingNextPage}
            hasNextPageError={isFetchNextPageError}
            onLoadMore={handleLoadMore}
          />
        </div>

        {/* Panel central — Conversación */}
        <div className="flex-1 h-full overflow-hidden">
          {selectedChat ? (
            <ChatThread
              chat={selectedChat}
              onRefreshSuggestions={() => requestSuggestions(selectedChat)}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-gray-300 dark:text-gray-700 gap-3 bg-slate-50 dark:bg-gray-900">
              <MessagesSquare className="w-12 h-12" strokeWidth={1.5} />
              <p className="text-sm text-gray-400 dark:text-gray-600">Selecciona un lead para ver la conversación</p>
            </div>
          )}
        </div>

        {/* Panel derecho — Sugerencias */}
        <div className="w-96 shrink-0 h-full overflow-hidden bg-gray-50 dark:bg-gray-900 border-l border-gray-200 dark:border-gray-800">
          {selectedChat ? (
            <SuggestionPanel
              chat={selectedChat}
              data={suggestionData}
              isLoading={isPending}
              error={apiError}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-gray-300 dark:text-gray-700 gap-3">
              <Sparkles className="w-12 h-12" strokeWidth={1.5} />
              <p className="text-sm text-gray-400 dark:text-gray-600 text-center px-6">Selecciona un lead para ver las sugerencias</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function AuthGate() {
  const { data: me, isLoading } = useMe()

  if (isLoading || me === undefined) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-100 dark:bg-gray-950">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    )
  }

  if (!me) {
    return <LoginPage />
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<MainLayout />} />
        <Route path="/chat/:chatId" element={<MainLayout />} />
      </Routes>
    </BrowserRouter>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthGate />
    </QueryClientProvider>
  )
}

import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, useLocation, useNavigate, useParams } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { Bell, BellOff, Columns3, Loader2, LogOut, MessagesSquare, Settings as SettingsIcon, Sparkles, Moon, Sun } from 'lucide-react'
import type { Chat, ChatFilters, SuggestionResponse } from './types'
import { ChatList } from './components/ChatList'
import { ChatThread } from './components/ChatThread'
import { KanbanBoard } from './components/KanbanBoard'
import { LoginPage } from './components/LoginPage'
import { SettingsDialog } from './components/SettingsDialog'
import { SuggestionPanel } from './components/SuggestionPanel'
import { useLogout, useMe } from './hooks/useAuth'
import { useChats, useChatUpdates, useInfiniteChats, useMarkChatRead, useUnreadCount } from './hooks/useChats'
import { useNotifications } from './hooks/useNotifications'
import { useSuggestions } from './hooks/useSuggestions'
import { useTheme } from './hooks/useTheme'
import { queryClient } from './queryClient'

const EMPTY_CHAT_FILTERS: ChatFilters = {
  unreadOnly: false,
  stages: [],
  tagIds: [],
  tagMode: 'any',
  service: '',
  seller: '',
  origin: '',
  lastSender: '',
  inactiveDays: null,
}

function MainLayout() {
  const { data: me } = useMe()
  const { mutate: logout } = useLogout()
  const { chatId } = useParams<{ chatId: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const isKanban = location.pathname === '/kanban'

  const { theme, toggleTheme } = useTheme()
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const { data: unreadCount = 0 } = useUnreadCount()
  const { permission: notificationPermission, requestPermission: requestNotificationPermission, notify } =
    useNotifications(unreadCount)

  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [chatFilter, setChatFilter] = useState<'all' | 'unread'>('all')
  const [advancedFilters, setAdvancedFilters] = useState<ChatFilters>(EMPTY_CHAT_FILTERS)
  const effectiveFilters: ChatFilters = {
    ...advancedFilters,
    unreadOnly: chatFilter === 'unread',
  }

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(timeout)
  }, [search])

  useChatUpdates(chatId ?? null, notify)

  const {
    data,
    isLoading,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
  } = useInfiniteChats(debouncedSearch, effectiveFilters)
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

  const { mutate: markChatRead } = useMarkChatRead()

  // Marca el chat como visto solo cuando realmente está visible. Si queda
  // seleccionado mientras la ventana está en segundo plano, sus mensajes
  // siguen pendientes hasta que el usuario regrese.
  useEffect(() => {
    function markVisibleChatRead() {
      if (chatId && !document.hidden && document.hasFocus()) markChatRead(chatId)
    }

    markVisibleChatRead()
    window.addEventListener('focus', markVisibleChatRead)
    document.addEventListener('visibilitychange', markVisibleChatRead)
    return () => {
      window.removeEventListener('focus', markVisibleChatRead)
      document.removeEventListener('visibilitychange', markVisibleChatRead)
    }
    // selectedChat.timestamp cambia si llega un mensaje al chat abierto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, selectedChat?.timestamp])

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
    <div className="flex h-screen w-full min-w-0 max-w-full flex-col overflow-hidden bg-gray-100 dark:bg-gray-950">
      {/* Barra superior */}
      <div className="flex h-12 w-full min-w-0 shrink-0 items-center gap-2 border-b border-gray-200 bg-white px-4 dark:border-gray-800 dark:bg-gray-900">
        <div className="w-6 h-6 rounded-md bg-green-600 flex items-center justify-center">
          <MessagesSquare className="w-3.5 h-3.5 text-white" />
        </div>
        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">DermicaPro</span>
        <span className="text-xs text-gray-400 dark:text-gray-500 ml-1">- Panel de leads</span>
        <nav className="ml-3 flex items-center rounded-lg bg-gray-100 p-0.5 dark:bg-gray-800" aria-label="Vista principal">
          <button
            onClick={() => navigate('/')}
            className={`relative flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors ${
              !isKanban
                ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100'
                : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            <MessagesSquare className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Chats</span>
            {unreadCount > 0 && (
              <span className="flex min-w-4 items-center justify-center rounded-full bg-green-600 px-1 text-[10px] font-semibold leading-4 text-white">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>
          <button
            onClick={() => navigate('/kanban')}
            className={`flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors ${
              isKanban
                ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100'
                : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            <Columns3 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Kanban</span>
          </button>
        </nav>
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
        {notificationPermission !== 'unsupported' && (
          <button
            onClick={notificationPermission === 'default' ? requestNotificationPermission : undefined}
            disabled={notificationPermission !== 'default'}
            aria-label={
              notificationPermission === 'granted'
                ? 'Notificaciones activadas'
                : notificationPermission === 'denied'
                  ? 'Notificaciones bloqueadas por el navegador'
                  : 'Activar notificaciones de mensajes nuevos'
            }
            title={
              notificationPermission === 'granted'
                ? 'Notificaciones activadas'
                : notificationPermission === 'denied'
                  ? 'Bloqueadas — habilitalas desde la configuración del navegador'
                  : 'Activar notificaciones de mensajes nuevos'
            }
            className={`flex items-center justify-center w-7 h-7 rounded-md transition-colors ${
              notificationPermission === 'granted'
                ? 'text-green-600 dark:text-green-500'
                : notificationPermission === 'denied'
                  ? 'text-gray-300 dark:text-gray-700 cursor-not-allowed'
                  : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            {notificationPermission === 'denied' ? <BellOff className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
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

      {isKanban ? (
        <KanbanBoard onOpenChat={handleSelectChat} />
      ) : (
      <div className="flex flex-1 overflow-hidden">
        {/* Panel izquierdo — Lista de chats */}
        <div className="w-80 shrink-0 h-full overflow-hidden">
          <ChatList
            chats={chats}
            isLoading={isLoading}
            error={!!error}
            search={search}
            onSearchChange={setSearch}
            filter={chatFilter}
            onFilterChange={setChatFilter}
            unreadCount={unreadCount}
            advancedFilters={advancedFilters}
            onAdvancedFiltersChange={setAdvancedFilters}
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
      )}
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
        <Route path="/kanban" element={<MainLayout />} />
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

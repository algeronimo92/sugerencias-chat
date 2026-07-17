import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { BrowserRouter, Navigate, Routes, Route, useLocation, useNavigate, useParams } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { BarChart3, CalendarClock, Columns3, FileText, FolderOpen, Loader2, LogOut, MessageSquareLock, MessagesSquare, Settings as SettingsIcon, Sparkles, Moon, Sun, Workflow, X } from 'lucide-react'
import type { Chat, ChatFilters, SuggestionResponse } from './types'
import { ChatList } from './components/ChatList'
import { ChatThread } from './components/ChatThread'
import { LoginPage } from './components/LoginPage'
import { SettingsDialog } from './components/SettingsDialog'
import { SuggestionPanel } from './components/SuggestionPanel'
import { NotificationCenter } from './components/NotificationCenter'
import { useLogout, useMe } from './hooks/useAuth'
import { useChats, useChatUpdates, useInfiniteChats, useMarkChatRead, useUnreadCount } from './hooks/useChats'
import type { InternalMentionAlert } from './hooks/useChats'
import { useNotifications } from './hooks/useNotifications'
import { useSuggestions } from './hooks/useSuggestions'
import { useTheme } from './hooks/useTheme'
import { queryClient } from './queryClient'

const KanbanBoard = lazy(() =>
  import('./components/KanbanBoard').then(module => ({ default: module.KanbanBoard })),
)
const TasksPage = lazy(() =>
  import('./components/TasksPage').then(module => ({ default: module.TasksPage })),
)
const TemplatesPage = lazy(() =>
  import('./components/TemplatesPage').then(module => ({ default: module.TemplatesPage })),
)
const DashboardPage = lazy(() =>
  import('./components/DashboardPage').then(module => ({ default: module.DashboardPage })),
)
const MediaLibraryPage = lazy(() =>
  import('./components/MediaLibraryPage').then(module => ({ default: module.MediaLibraryPage })),
)
const AutomationsPage = lazy(() =>
  import('./components/AutomationsPage').then(module => ({ default: module.AutomationsPage })),
)

const EMPTY_CHAT_FILTERS: ChatFilters = {
  unreadOnly: false,
  stages: [],
  tagIds: [],
  tagMode: 'any',
  service: '',
  sellerId: null,
  origin: '',
  lastSender: '',
  inactiveDays: null,
  waitingTime: '',
}

function PageLoader() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-gray-50 dark:bg-gray-950">
      <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
        <Loader2 className="h-5 w-5 animate-spin" />
        Cargando vista…
      </div>
    </div>
  )
}

function MainLayout() {
  const { data: me } = useMe()
  const { mutate: logout } = useLogout()
  const { chatId } = useParams<{ chatId: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const isKanban = location.pathname === '/kanban'
  const isTasks = location.pathname === '/tasks'
  const isTemplates = location.pathname === '/templates'
  const isMediaLibrary = location.pathname === '/media-library'
  const isDashboard = location.pathname === '/dashboard'
  const isAutomations = location.pathname === '/automations'
  const isChats = location.pathname === '/' || location.pathname.startsWith('/chat/')

  const { theme, toggleTheme } = useTheme()
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const { data: unreadCount = 0 } = useUnreadCount()
  const { permission: notificationPermission, requestPermission: requestNotificationPermission, notify } =
    useNotifications(unreadCount)
  const [internalMention, setInternalMention] = useState<InternalMentionAlert | null>(null)
  const surfacedNotificationIdsRef = useRef(new Set<number>())

  function showInternalMention(alert: InternalMentionAlert) {
    if (surfacedNotificationIdsRef.current.has(alert.notificationId)) return
    surfacedNotificationIdsRef.current.add(alert.notificationId)
    setInternalMention(alert)
  }

  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [chatFilter, setChatFilter] = useState<'all' | 'unread' | 'mine'>('all')
  const [advancedFilters, setAdvancedFilters] = useState<ChatFilters>(EMPTY_CHAT_FILTERS)
  const effectiveFilters: ChatFilters = {
    ...advancedFilters,
    unreadOnly: chatFilter === 'unread',
    // "Mis leads" pisa el filtro de vendedor de los avanzados mientras está
    // activo — no tiene sentido combinarlos, y así al desactivarlo se
    // vuelve solo al filtro avanzado que el usuario haya dejado cargado.
    sellerId: chatFilter === 'mine' ? (me?.id ?? null) : advancedFilters.sellerId,
  }

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(timeout)
  }, [search])

  useChatUpdates(chatId ?? null, notify, showInternalMention)

  useEffect(() => {
    if (!internalMention) return
    const timeout = window.setTimeout(() => setInternalMention(null), 8000)
    return () => window.clearTimeout(timeout)
  }, [internalMention])

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
        <span className="text-xs text-gray-400 dark:text-gray-500 ml-1">CRM</span>
        <nav className="ml-3 flex items-center rounded-lg bg-gray-100 p-0.5 dark:bg-gray-800" aria-label="Vista principal">
          <button
            onClick={() => navigate('/')}
            className={`relative flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors ${
              isChats
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
          <button
            onClick={() => navigate('/tasks')}
            className={`flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors ${
              isTasks
                ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100'
                : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            <CalendarClock className="h-3.5 w-3.5" />
            <span className="hidden md:inline">Tareas</span>
          </button>
          {me?.role === 'admin' && (
            <button
              onClick={() => navigate('/dashboard')}
              className={`flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors ${
                isDashboard
                  ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100'
                  : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
              }`}
            >
              <BarChart3 className="h-3.5 w-3.5" />
              <span className="hidden lg:inline">Dashboard</span>
            </button>
          )}
          {me?.role === 'admin' && (
            <button
              onClick={() => navigate('/automations')}
              className={`flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors ${
                isAutomations
                  ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100'
                  : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
              }`}
            >
              <Workflow className="h-3.5 w-3.5" />
              <span className="hidden xl:inline">Automatizaciones</span>
            </button>
          )}
          {me?.role === 'admin' && (
            <button
              onClick={() => navigate('/templates')}
              className={`flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors ${
                isTemplates
                  ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100'
                  : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
              }`}
            >
              <FileText className="h-3.5 w-3.5" />
              <span className="hidden lg:inline">Plantillas</span>
            </button>
          )}
          {me?.role === 'admin' && (
            <button
              onClick={() => navigate('/media-library')}
              className={`flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors ${
                isMediaLibrary
                  ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100'
                  : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
              }`}
            >
              <FolderOpen className="h-3.5 w-3.5" />
              <span className="hidden xl:inline">Archivos</span>
            </button>
          )}
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
        <NotificationCenter
          browserPermission={notificationPermission}
          onRequestBrowserPermission={requestNotificationPermission}
          onNewNotification={showInternalMention}
        />
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

      {internalMention && (
        <div className="fixed right-4 top-16 z-[70] w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-950 shadow-2xl dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          <div className="flex items-start gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-200 text-amber-800 dark:bg-amber-900 dark:text-amber-200"><MessageSquareLock className="h-4 w-4" /></span>
            <button type="button" onClick={() => { navigate(`/chat/${internalMention.leadId}`); setInternalMention(null) }} className="min-w-0 flex-1 text-left">
              <span className="block text-xs font-semibold">{internalMention.authorName} te mencionó</span>
              <span className="mt-0.5 block line-clamp-2 text-xs text-amber-800/80 dark:text-amber-200/80">{internalMention.content}</span>
            </button>
            <button type="button" onClick={() => setInternalMention(null)} className="rounded p-1 text-amber-700 hover:bg-amber-100 dark:text-amber-400 dark:hover:bg-amber-900"><X className="h-4 w-4" /></button>
          </div>
        </div>
      )}

      <Suspense fallback={<PageLoader />}>
        {isTasks ? (
          <TasksPage onOpenChat={(id) => navigate(`/chat/${id}`)} />
        ) : isDashboard && me?.role === 'admin' ? (
          <DashboardPage
            onOpenTasks={() => navigate('/tasks')}
            onFilterChats={(filters) => {
              setChatFilter('all')
              setAdvancedFilters({ ...EMPTY_CHAT_FILTERS, ...filters })
              navigate('/')
            }}
          />
        ) : isTemplates && me?.role === 'admin' ? (
          <TemplatesPage />
        ) : isAutomations && me?.role === 'admin' ? (
          <AutomationsPage />
        ) : isMediaLibrary && me?.role === 'admin' ? (
          <MediaLibraryPage />
        ) : isKanban ? (
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
      </Suspense>
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
        <Route path="/tasks" element={<MainLayout />} />
        <Route path="/templates" element={me.role === 'admin' ? <MainLayout /> : <Navigate to="/" replace />} />
        <Route path="/media-library" element={me.role === 'admin' ? <MainLayout /> : <Navigate to="/" replace />} />
        <Route path="/dashboard" element={me.role === 'admin' ? <MainLayout /> : <Navigate to="/" replace />} />
        <Route path="/automations" element={me.role === 'admin' ? <MainLayout /> : <Navigate to="/" replace />} />
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

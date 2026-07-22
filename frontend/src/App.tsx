import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { BrowserRouter, Navigate, Routes, Route, useLocation, useNavigate, useParams } from 'react-router-dom'
import { QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, BarChart3, CalendarClock, Columns3, FileText, FolderOpen, Loader2, LogOut, MessageSquareLock, MessagesSquare, RefreshCw, Settings as SettingsIcon, Sparkles, Moon, Sun, Workflow, X } from 'lucide-react'
import type { Chat, ChatFilters } from './types'
import { ChatList } from './components/ChatList'
import { ChatThread } from './components/ChatThread'
import { LoginPage } from './components/LoginPage'
import { SettingsDialog } from './components/SettingsDialog'
import { SuggestionPanel } from './components/SuggestionPanel'
import { NotificationCenter } from './components/NotificationCenter'
import { useLogout, useMe } from './hooks/useAuth'
import { useChat, useChatUpdates, useInfiniteChats, useMarkChatRead, useUnreadCount } from './hooks/useChats'
import type { InternalMentionAlert } from './hooks/useChats'
import { useNotifications } from './hooks/useNotifications'
import { useSuggestions, useRefreshSuggestions } from './hooks/useSuggestions'
import { useWhatsappStatus } from './hooks/useWhatsapp'
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
  const [settingsInitialTab, setSettingsInitialTab] = useState<'claves' | 'whatsapp' | 'usuarios'>('claves')

  function openSettings(tab: 'claves' | 'whatsapp' | 'usuarios' = 'claves') {
    setSettingsInitialTab(tab)
    setIsSettingsOpen(true)
  }
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

  // Estado de la conexión de WhatsApp — solo admin (el endpoint es admin-only).
  // Alimenta el CTA del estado vacío cuando la instancia no está vinculada.
  const { data: whatsappStatus } = useWhatsappStatus({ enabled: me?.role === 'admin' })
  const showConnectWhatsapp = me?.role === 'admin' && whatsappStatus != null && whatsappStatus.state !== 'open'

  function handleLoadMore() {
    if (hasNextPage && !isFetchingNextPage) return fetchNextPage()
  }

  // Consulta directa por clave primaria, independiente de la búsqueda de la lista.
  const { data: selectedChat = null } = useChat(chatId ?? null)

  const rqClient = useQueryClient()

  // Sugerencias cacheadas por chat: reabrir un lead ya visto las muestra al
  // instante (sin volver a llamar a n8n) y solo revalida en segundo plano si
  // quedaron obsoletas. La invalidación al llegar un mensaje nuevo del cliente
  // vive en useChatUpdates, para que la vista no quede mostrando algo viejo.
  const {
    data: suggestionData = null,
    isLoading: isSuggestionsLoading,
    isFetching: isSuggestionsFetching,
    error: suggestionsError,
  } = useSuggestions(selectedChat?.chat_id ?? null, selectedChat?.phone ?? null)

  // "Pedir otras": fuerza un juego nuevo cuando las cacheadas no sirven.
  const { mutate: regenerateSuggestions, isPending: isRegenerating } = useRefreshSuggestions()

  const suggestionsErrorMessage = suggestionsError instanceof Error ? suggestionsError.message : null

  const { mutate: markChatRead } = useMarkChatRead()

  // Marca el chat como visto solo cuando realmente está visible. Si queda
  // seleccionado mientras la ventana está en segundo plano, sus mensajes
  // siguen pendientes hasta que el usuario regrese.
  useEffect(() => {
    function markVisibleChatRead() {
      if (chatId && selectedChat && selectedChat.unread_count > 0 && !document.hidden && document.hasFocus()) {
        markChatRead(chatId)
      }
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
  }, [chatId, selectedChat?.unread_count])

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
            onClick={() => openSettings('claves')}
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

      {isSettingsOpen && <SettingsDialog onClose={() => setIsSettingsOpen(false)} initialTab={settingsInitialTab} />}

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
                showConnectWhatsapp={showConnectWhatsapp}
                onConnectWhatsapp={() => openSettings('whatsapp')}
              />
            </div>

            {/* Panel central — Conversación */}
            <div className="flex-1 h-full overflow-hidden">
              {selectedChat ? (
                <ChatThread
                  chat={selectedChat}
                  onRefreshSuggestions={() => rqClient.invalidateQueries({ queryKey: ['suggestions', selectedChat.chat_id] })}
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
                  isLoading={isSuggestionsLoading || isRegenerating}
                  isRefreshing={isSuggestionsFetching && !isSuggestionsLoading && !isRegenerating}
                  error={suggestionsErrorMessage}
                  onRegenerate={() => regenerateSuggestions({ chat_id: selectedChat.chat_id, phone: selectedChat.phone })}
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
  const { data: me, error, isError, isLoading, isFetching, refetch } = useMe()

  if (isError) {
    const detail = error instanceof Error && error.message !== 'Network Error'
      ? error.message
      : 'No se pudo establecer conexión con el servidor.'

    return (
      <div className="flex h-screen items-center justify-center bg-gray-100 p-4 dark:bg-gray-950">
        <div role="alert" className="w-full max-w-md rounded-2xl border border-red-200 bg-white p-6 text-center shadow-xl dark:border-red-900 dark:bg-gray-900">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-950/50 dark:text-red-400">
            <AlertTriangle className="h-6 w-6" />
          </span>
          <h1 className="mt-4 text-lg font-semibold text-gray-900 dark:text-white">Backend no disponible</h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            El frontend está funcionando, pero no pudo consultar tu sesión en el servidor.
          </p>
          <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500 dark:bg-gray-800 dark:text-gray-400">
            {detail}
          </p>
          <button
            type="button"
            disabled={isFetching}
            onClick={() => { void refetch() }}
            className="mt-5 inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-green-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-green-700 disabled:cursor-wait disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
            {isFetching ? 'Reconectando…' : 'Reintentar conexión'}
          </button>
        </div>
      </div>
    )
  }

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

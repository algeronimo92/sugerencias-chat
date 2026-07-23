import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { BrowserRouter, Navigate, Routes, Route, useLocation, useNavigate, useParams } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
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
import { Button, Spinner } from './components/ui'
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
    <div className="flex min-h-0 flex-1 items-center justify-center bg-wa-app dark:bg-wa-app-dark">
      <Spinner label="Cargando vista…" />
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
    // Resultado de búsqueda que matcheó por un mensaje del historial: se pasa
    // el id por el estado de navegación para saltar hasta él y resaltarlo.
    if (chat.search_rank === 0 && chat.matched_message_id) {
      navigate(`/chat/${chat.chat_id}`, { state: { highlightMessageId: chat.matched_message_id } })
    } else {
      navigate(`/chat/${chat.chat_id}`)
    }
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

  // Nav sobre la barra verde (#008069) en claro y sobre #202C33 en oscuro,
  // como WhatsApp Web: pestañas translúcidas blancas, activa más sólida.
  const navTabClass = (active: boolean) =>
    `flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors ${
      active
        ? 'bg-white/25 text-white shadow-sm dark:bg-wa-active-dark dark:text-wa-text-dark'
        : 'text-white/80 hover:bg-white/10 hover:text-white dark:text-wa-muted-dark dark:hover:bg-white/5 dark:hover:text-wa-text-dark'
    }`

  const headerIconButtonClass =
    'flex items-center justify-center w-7 h-7 rounded-md text-white/80 hover:bg-white/10 hover:text-white dark:text-wa-muted-dark dark:hover:bg-white/5 dark:hover:text-wa-text-dark transition-colors'

  return (
    <div className="flex h-screen w-full min-w-0 max-w-full flex-col overflow-hidden bg-wa-app dark:bg-wa-app-dark">
      {/* Barra superior — verde WhatsApp en claro, panel oscuro en dark */}
      <div className="flex h-12 w-full min-w-0 shrink-0 items-center gap-2 bg-wa-primary-strong px-4 dark:border-b dark:border-wa-border-dark dark:bg-wa-head-dark">
        <div className="w-6 h-6 rounded-md bg-white/20 dark:bg-wa-primary flex items-center justify-center">
          <MessagesSquare className="w-3.5 h-3.5 text-white" />
        </div>
        <span className="text-sm font-semibold text-white dark:text-wa-text-dark">DermicaPro</span>
        <span className="text-xs text-white/60 dark:text-wa-muted-dark ml-1">CRM</span>
        <nav className="ml-3 flex items-center rounded-lg bg-black/10 p-0.5 dark:bg-black/20" aria-label="Vista principal">
          <button onClick={() => navigate('/')} className={`relative ${navTabClass(isChats)}`}>
            <MessagesSquare className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Chats</span>
            {unreadCount > 0 && (
              <span className="flex min-w-4 items-center justify-center rounded-full bg-white px-1 text-[10px] font-semibold leading-4 text-wa-primary-strong dark:bg-wa-primary dark:text-white">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>
          <button onClick={() => navigate('/kanban')} className={navTabClass(isKanban)}>
            <Columns3 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Kanban</span>
          </button>
          <button onClick={() => navigate('/tasks')} className={navTabClass(isTasks)}>
            <CalendarClock className="h-3.5 w-3.5" />
            <span className="hidden md:inline">Tareas</span>
          </button>
          {me?.role === 'admin' && (
            <button onClick={() => navigate('/dashboard')} className={navTabClass(isDashboard)}>
              <BarChart3 className="h-3.5 w-3.5" />
              <span className="hidden lg:inline">Dashboard</span>
            </button>
          )}
          {me?.role === 'admin' && (
            <button onClick={() => navigate('/automations')} className={navTabClass(isAutomations)}>
              <Workflow className="h-3.5 w-3.5" />
              <span className="hidden xl:inline">Automatizaciones</span>
            </button>
          )}
          {me?.role === 'admin' && (
            <button onClick={() => navigate('/templates')} className={navTabClass(isTemplates)}>
              <FileText className="h-3.5 w-3.5" />
              <span className="hidden lg:inline">Plantillas</span>
            </button>
          )}
          {me?.role === 'admin' && (
            <button onClick={() => navigate('/media-library')} className={navTabClass(isMediaLibrary)}>
              <FolderOpen className="h-3.5 w-3.5" />
              <span className="hidden xl:inline">Archivos</span>
            </button>
          )}
        </nav>
        <span className="flex-1" />
        {me && (
          <span className="text-xs text-white/70 dark:text-wa-muted-dark hidden sm:inline">
            {me.name} <span className="opacity-70">({me.role === 'admin' ? 'admin' : 'vendedor'})</span>
          </span>
        )}
        {me?.role === 'admin' && (
          <button
            onClick={() => openSettings('claves')}
            aria-label="Configuración"
            title="Configuración"
            className={headerIconButtonClass}
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
          className={headerIconButtonClass}
        >
          {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
        <button
          onClick={() => logout()}
          aria-label="Cerrar sesión"
          title="Cerrar sesión"
          className={headerIconButtonClass}
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
                  highlightMessageId={(location.state as { highlightMessageId?: number } | null)?.highlightMessageId ?? null}
                />
              ) : (
                <div className="flex flex-col items-center justify-center h-full gap-3 border-b-[6px] border-wa-primary bg-wa-app text-wa-muted/50 dark:border-wa-primary/60 dark:bg-wa-panel-dark dark:text-wa-muted-dark/50">
                  <MessagesSquare className="w-12 h-12" strokeWidth={1.25} />
                  <p className="text-sm text-wa-muted dark:text-wa-muted-dark">Selecciona un lead para ver la conversación</p>
                </div>
              )}
            </div>

            {/* Panel derecho — Sugerencias */}
            <div className="w-96 shrink-0 h-full overflow-hidden bg-wa-app dark:bg-wa-panel-dark border-l border-wa-border dark:border-wa-border-dark">
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
                <div className="flex flex-col items-center justify-center h-full gap-3 text-wa-muted/50 dark:text-wa-muted-dark/50">
                  <Sparkles className="w-12 h-12" strokeWidth={1.25} />
                  <p className="text-sm text-wa-muted dark:text-wa-muted-dark text-center px-6">Selecciona un lead para ver las sugerencias</p>
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
      <div className="flex h-screen items-center justify-center bg-wa-app p-4 dark:bg-wa-app-dark">
        <div role="alert" className="w-full max-w-md rounded-2xl border border-red-200 bg-white p-6 text-center shadow-xl dark:border-red-900 dark:bg-wa-panel-dark">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-950/50 dark:text-red-400">
            <AlertTriangle className="h-6 w-6" />
          </span>
          <h1 className="mt-4 text-lg font-semibold text-wa-text dark:text-wa-text-dark">Backend no disponible</h1>
          <p className="mt-2 text-sm text-wa-muted dark:text-wa-muted-dark">
            El frontend está funcionando, pero no pudo consultar tu sesión en el servidor.
          </p>
          <p className="mt-3 rounded-lg bg-wa-field px-3 py-2 text-xs text-wa-muted dark:bg-wa-field-dark dark:text-wa-muted-dark">
            {detail}
          </p>
          <Button
            disabled={isFetching}
            onClick={() => { void refetch() }}
            className="mt-5"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} aria-hidden="true" />
            {isFetching ? 'Reconectando…' : 'Reintentar conexión'}
          </Button>
        </div>
      </div>
    )
  }

  if (isLoading || me === undefined) {
    return (
      <div className="flex items-center justify-center h-screen bg-wa-app dark:bg-wa-app-dark">
        <Loader2 className="w-6 h-6 animate-spin text-wa-muted dark:text-wa-muted-dark" />
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

import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { BrowserRouter, Navigate, Routes, Route, useLocation, useNavigate, useParams } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { AnimatePresence, motion, MotionConfig } from 'motion/react'
import { toast } from 'sonner'
import { AlertTriangle, Bug, Loader2, LogOut, MessageSquareLock, MessagesSquare, RefreshCw, Settings as SettingsIcon, ShieldCheck, Sparkles, Moon, Sun, X } from 'lucide-react'
import { EMPTY_CHAT_FILTERS, type Chat, type ChatFilters } from './types'
import { ChatList } from './components/ChatList'
import { ChatPeekDialog } from './components/ChatPeekDialog'
import { ChatThread } from './components/ChatThread'
import { LoginPage } from './components/LoginPage'
import { MobileNavBar } from './components/MobileNavBar'
import { NotificationCenter } from './components/NotificationCenter'
import { PwaUpdatePrompt } from './components/PwaUpdatePrompt'
import { isNavItemActive, visibleNavItems } from './domain/navigation'
import { useLayout } from './hooks/useBreakpoint'
import { useLogout, useMe } from './hooks/useAuth'
import { useChat, useChatUpdates, useInfiniteChats, useMarkChatRead, useMarkChatUnread, useUnreadCount } from './hooks/useChats'
import type { InternalMentionAlert } from './hooks/useChats'
import { useNotifications } from './hooks/useNotifications'
import { useSuggestionStatus, useGenerateSuggestions } from './hooks/useSuggestions'
import { useWhatsappStatus } from './hooks/useWhatsapp'
import { useTheme } from './hooks/useTheme'
import { Button } from './components/ui/Button'
import { Spinner } from './components/ui/Spinner'
import { AppToaster } from './components/ui/Toaster'
import { Tooltip } from './components/ui/Tooltip'
import { queryClient } from './queryClient'
import { hasOpenOverlay } from './utils/overlay'
import { extractErrorMessage } from './utils/errors'

// Puras y sin estado: viven en ámbito de módulo para no reconstruirse en
// cada render, lo que además rompía la memoización de los hijos.
const navTabClass = (active: boolean) =>
  `flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors ${
    active
      ? 'bg-white/25 text-white shadow-sm dark:bg-wa-field-dark dark:text-white dark:ring-1 dark:ring-white/[0.06]'
      : 'text-white/80 hover:bg-white/10 hover:text-white dark:text-wa-muted-dark dark:hover:bg-wa-head-dark dark:hover:text-wa-text-dark'
  }`

// Las clases de Tailwind tienen que existir literales en el código para que el
// compilador las detecte; de ahí el mapa en vez de armar el string a mano.
const NAV_LABEL_VISIBILITY = {
  sm: 'hidden sm:inline',
  md: 'hidden md:inline',
  lg: 'hidden lg:inline',
  xl: 'hidden xl:inline',
} as const


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
const CatalogsPage = lazy(() =>
  import('./components/CatalogsPage').then(module => ({ default: module.CatalogsPage })),
)
const SettingsDialog = lazy(() =>
  import('./components/SettingsDialog').then(module => ({ default: module.SettingsDialog })),
)
const AccountSecurityDialog = lazy(() =>
  import('./components/AccountSecurityDialog').then(module => ({ default: module.AccountSecurityDialog })),
)
const IssueReportDialog = lazy(() =>
  import('./components/IssueReportDialog').then(module => ({ default: module.IssueReportDialog })),
)
const IssueReportsPage = lazy(() =>
  import('./components/IssueReportsPage').then(module => ({ default: module.IssueReportsPage })),
)
const SuggestionPanel = lazy(() =>
  import('./components/SuggestionPanel').then(module => ({ default: module.SuggestionPanel })),
)

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
  const { chatId: chatIdParam } = useParams<{ chatId: string }>()
  const chatId = chatIdParam ?? null
  const navigate = useNavigate()

  // Cuando se hace clic en una notificación push con la app ya abierta en
  // otra pestaña, push-sw.js (frontend/public/push-sw.js) enfoca esa pestaña
  // y le manda la URL destino por postMessage en vez de navegar directo,
  // porque el service worker no tiene acceso al router de React. El
  // registro del SW vive en PwaUpdatePrompt, pero ese componente se monta
  // fuera del BrowserRouter (a propósito, para registrar el SW aunque la
  // sesión no esté resuelta) y no tiene `navigate`; por eso el listener del
  // mensaje vive acá, donde sí lo hay.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    function handleMessage(event: MessageEvent) {
      if (event.data?.type === 'push-navigate' && typeof event.data.url === 'string') {
        navigate(event.data.url)
      }
    }
    navigator.serviceWorker.addEventListener('message', handleMessage)
    return () => navigator.serviceWorker.removeEventListener('message', handleMessage)
  }, [navigate])
  const location = useLocation()
  const isKanban = location.pathname === '/kanban'
  const isTasks = location.pathname === '/tasks'
  const isTemplates = location.pathname === '/templates'
  const isMediaLibrary = location.pathname === '/media-library'
  const isDashboard = location.pathname === '/dashboard'
  const isAutomations = location.pathname === '/automations'
  const isCatalogs = location.pathname === '/catalogs'
  const isIssueReports = location.pathname === '/reports'

  // 'mobile' = una vista a la vez + navegación inferior; 'tablet' = lista y
  // conversación, con las sugerencias en un panel deslizable; 'desktop' = las
  // tres columnas de siempre.
  const layout = useLayout()
  const isMobile = layout === 'mobile'
  const isDesktop = layout === 'desktop'
  const [isSuggestionsOpen, setIsSuggestionsOpen] = useState(false)
  const [previewChat, setPreviewChat] = useState<Chat | null>(null)

  const { theme, toggleTheme } = useTheme()
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isAccountSecurityOpen, setIsAccountSecurityOpen] = useState(false)
  const [isIssueReportOpen, setIsIssueReportOpen] = useState(false)
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

  async function handleLoadMore(): Promise<void> {
    if (hasNextPage && !isFetchingNextPage) await fetchNextPage()
  }

  // Consulta directa por clave primaria, independiente de la búsqueda de la lista.
  const { data: selectedChat = null } = useChat(chatId ?? null)


  // Sugerencias a demanda: al abrir un chat solo se LEE lo ya generado
  // (gratis, sin IA). Generar es siempre una acción explícita del vendedor.
  // Si llega un mensaje nuevo del cliente, useChatUpdates invalida esta query
  // y el refetch apenas marca la sugerencia como desactualizada (stale).
  const { data: suggestionStatus = null, isLoading: isSuggestionsLoading } =
    useSuggestionStatus(selectedChat?.chat_id ?? null)

  // Única vía que llama a la IA: CTA "Generá sugerencias" / "Generá otras".
  const generateSuggestionsMutation = useGenerateSuggestions()
  const isGeneratingForSelected =
    generateSuggestionsMutation.isPending &&
    generateSuggestionsMutation.variables?.chat_id === selectedChat?.chat_id
  const suggestionsErrorMessage =
    generateSuggestionsMutation.error instanceof Error &&
    generateSuggestionsMutation.variables?.chat_id === selectedChat?.chat_id
      ? generateSuggestionsMutation.error.message
      : null

  const { mutate: markChatRead } = useMarkChatRead()
  const markChatUnread = useMarkChatUnread()

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

  function handleMarkChatUnread(chat: Chat) {
    if (chat.chat_id === chatId) handleCloseChat()
    markChatUnread.mutate(chat.chat_id, {
      onSuccess: () => toast.success(`${chat.name || chat.phone || 'Chat'} marcado como no leído`),
      onError: error => toast.error(extractErrorMessage(error)),
    })
  }

  // Fuera de escritorio las sugerencias son un panel superpuesto: al saltar a
  // otro lead tiene que cerrarse, o quedaría mostrando el anterior.
  useEffect(() => {
    setIsSuggestionsOpen(false)
  }, [chatId])

  // El panel de sugerencias, compartido por la columna de escritorio y el
  // panel deslizable de móvil/tablet.
  function renderSuggestionPanel(chat: Chat) {
    return (
      <SuggestionPanel
        chat={chat}
        data={suggestionStatus?.suggestion ?? null}
        generatedAt={suggestionStatus?.generated_at ?? null}
        isStale={suggestionStatus?.stale ?? false}
        isLoading={isSuggestionsLoading}
        isGenerating={isGeneratingForSelected}
        error={suggestionsErrorMessage}
        onGenerate={(force = false, instruction) =>
          generateSuggestionsMutation.mutate({
            chat_id: chat.chat_id,
            phone: chat.phone,
            force,
            instruction,
          })
        }
      />
    )
  }

  // Escape cierra el lead abierto, igual que WhatsApp
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      // Una pulsación cierra una sola capa, la de más arriba. Con un diálogo
      // encima (la vista previa de una plantilla, el visor de multimedia, un
      // confirmar…) el Escape es de ese diálogo y el lead de atrás no se toca.
      if (hasOpenOverlay()) return
      // El panel de sugerencias no es un diálogo pero también tapa el chat.
      if (isSuggestionsOpen) {
        setIsSuggestionsOpen(false)
        return
      }
      if (selectedChat) {
        handleCloseChat()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChat?.chat_id, isSuggestionsOpen])

  // La barra global usa la superficie más profunda; los encabezados de cada
  // columna usan wa-head-dark para que ambos niveles se distingan sin chocar.

  const headerIconButtonClass =
    'flex items-center justify-center w-7 h-7 rounded-md text-white/80 hover:bg-white/10 hover:text-white dark:text-wa-muted-dark dark:hover:bg-wa-head-dark dark:hover:text-wa-text-dark transition-colors'

  return (
    <div data-issue-capture-root className="flex h-full w-full min-w-0 max-w-full flex-col overflow-hidden bg-wa-app dark:bg-wa-app-dark">
      {/* Barra superior — nivel global, más profundo que los headers locales. */}
      {/* min-h-12 y no h-12: con pt-safe la barra crece lo que mida el notch
          para que su verde llegue hasta el borde de la pantalla. */}
      <div className="flex min-h-12 w-full min-w-0 shrink-0 items-center gap-2 border-b border-wa-primary-deep bg-wa-primary-strong px-3 pt-safe shadow-sm sm:px-4 dark:border-wa-border-dark dark:bg-wa-panel-dark">
        <div className="w-6 h-6 rounded-md bg-white/20 dark:bg-wa-primary flex items-center justify-center shrink-0">
          <MessagesSquare className="w-3.5 h-3.5 text-white" />
        </div>
        <span className="text-sm font-semibold text-white">DermicaPro</span>
        <span className="text-xs text-white/60 dark:text-wa-muted-dark ml-1 hidden sm:inline">CRM</span>
        {/* En móvil estas pestañas se mudan a la barra inferior: siete vistas
            no entran arriba, y a esa altura no son alcanzables con el pulgar. */}
        <nav className="ml-3 hidden items-center rounded-lg bg-black/10 p-0.5 md:flex dark:border dark:border-white/[0.05] dark:bg-wa-app-dark/70" aria-label="Vista principal">
          {visibleNavItems(me?.role === 'admin').map((item) => {
            const Icon = item.icon
            const active = isNavItemActive(item, location.pathname)
            const showBadge = item.path === '/' && unreadCount > 0
            return (
              <button
                key={item.path}
                type="button"
                onClick={() => navigate(item.path)}
                className={`${showBadge ? 'relative ' : ''}${navTabClass(active)}`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span className={NAV_LABEL_VISIBILITY[item.labelFrom]}>{item.label}</span>
                {showBadge && (
                  <span className="flex min-w-4 items-center justify-center rounded-full bg-white px-1 text-[10px] font-semibold leading-4 text-wa-primary-strong dark:bg-wa-primary dark:text-white">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </button>
            )
          })}
        </nav>
        <span className="flex-1" />
        {me && (
          <span className="text-xs text-white/70 dark:text-wa-muted-dark hidden lg:inline">
            {me.name} <span className="opacity-70">({me.role === 'admin' ? 'admin' : 'vendedor'})</span>
          </span>
        )}
        {me?.role === 'admin' && (
          <Tooltip content="Configuración">
            <button type="button" onClick={() => openSettings('claves')} aria-label="Configuración" className={headerIconButtonClass}>
              <SettingsIcon className="w-4 h-4" />
            </button>
          </Tooltip>
        )}
        <Tooltip content="Reportar un problema">
          <button
            type="button"
            onClick={() => setIsIssueReportOpen(true)}
            aria-label="Reportar un problema"
            className="flex h-7 w-7 items-center justify-center rounded-md border border-white/15 bg-[#7a1f36] text-white shadow-sm transition-colors hover:bg-[#922744] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300/80 focus-visible:ring-offset-1 focus-visible:ring-offset-wa-deep-dark dark:border-rose-300/15 dark:bg-[#681a2e] dark:hover:bg-[#81213a]"
          >
            <Bug className="h-4 w-4" />
          </button>
        </Tooltip>
        <Tooltip content="Acceso y seguridad">
          <button type="button" onClick={() => setIsAccountSecurityOpen(true)} aria-label="Acceso y seguridad" className={headerIconButtonClass}>
            <ShieldCheck className="h-4 w-4" />
          </button>
        </Tooltip>
        <NotificationCenter
          browserPermission={notificationPermission}
          onRequestBrowserPermission={requestNotificationPermission}
          onNewNotification={showInternalMention}
        />
        <Tooltip content={theme === 'dark' ? 'Activar modo claro' : 'Activar modo oscuro'}>
          <button type="button" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Activar modo claro' : 'Activar modo oscuro'} className={headerIconButtonClass}>
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </Tooltip>
        <Tooltip content="Cerrar sesión">
          <button type="button" onClick={() => logout()} aria-label="Cerrar sesión" className={headerIconButtonClass}>
            <LogOut className="w-4 h-4" />
          </button>
        </Tooltip>
      </div>

      {isSettingsOpen && (
        <Suspense fallback={null}>
          <SettingsDialog onClose={() => setIsSettingsOpen(false)} initialTab={settingsInitialTab} />
        </Suspense>
      )}
      {isAccountSecurityOpen && (
        <Suspense fallback={null}>
          <AccountSecurityDialog onClose={() => setIsAccountSecurityOpen(false)} />
        </Suspense>
      )}
      {isIssueReportOpen && (
        <Suspense fallback={null}>
          <IssueReportDialog
            open
            currentPath={`${location.pathname}${location.search}`}
            leadId={chatId}
            onClose={() => setIsIssueReportOpen(false)}
          />
        </Suspense>
      )}

      <AnimatePresence>
      {internalMention && (
        <motion.div
          initial={{ opacity: 0, y: -12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.98 }}
          transition={{ duration: 0.18 }}
          className="fixed right-4 top-16 z-[70] w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-950 shadow-2xl dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
        >
          <div className="flex items-start gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-200 text-amber-800 dark:bg-amber-900 dark:text-amber-200"><MessageSquareLock className="h-4 w-4" /></span>
            <button type="button" onClick={() => { navigate(`/chat/${internalMention.leadId}`); setInternalMention(null) }} className="min-w-0 flex-1 text-left">
              <span className="block text-xs font-semibold">{internalMention.authorName} te mencionó</span>
              <span className="mt-0.5 block line-clamp-2 text-xs text-amber-800/80 dark:text-amber-200/80">{internalMention.content}</span>
            </button>
            <button type="button" onClick={() => setInternalMention(null)} className="rounded p-1 text-amber-700 hover:bg-amber-100 dark:text-amber-400 dark:hover:bg-amber-900"><X className="h-4 w-4" /></button>
          </div>
        </motion.div>
      )}
      </AnimatePresence>

      <Suspense fallback={<PageLoader />}>
        {isTasks ? (
          <TasksPage onOpenChat={(id) => navigate(`/chat/${id}`)} />
        ) : isIssueReports ? (
          <IssueReportsPage onCreate={() => setIsIssueReportOpen(true)} />
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
        ) : isCatalogs && me?.role === 'admin' ? (
          <CatalogsPage />
        ) : isMediaLibrary && me?.role === 'admin' ? (
          <MediaLibraryPage />
        ) : isKanban ? (
          <KanbanBoard onOpenChat={handleSelectChat} />
        ) : (
          <div className="flex min-w-0 flex-1 overflow-hidden">
            {/* Panel izquierdo — Lista de chats.
                En móvil ocupa la pantalla entera y se retira al abrir un chat:
                no hay lugar para las dos cosas a la vez. */}
            <div className={`h-full overflow-hidden ${isMobile ? (chatId ? 'hidden' : 'w-full') : 'w-72 shrink-0 xl:w-80'}`}>
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
                onRefresh={async () => { await refetch() }}
                selectedId={selectedChat?.chat_id ?? null}
                onSelect={handleSelectChat}
                onPreview={setPreviewChat}
                onMarkUnread={handleMarkChatUnread}
                markingUnreadId={markChatUnread.isPending ? markChatUnread.variables : null}
                hasNextPage={!!hasNextPage}
                isFetchingNextPage={isFetchingNextPage}
                hasNextPageError={isFetchNextPageError}
                onLoadMore={handleLoadMore}
                showConnectWhatsapp={showConnectWhatsapp}
                onConnectWhatsapp={() => openSettings('whatsapp')}
              />
            </div>

            {/* Panel central — Conversación */}
            {(!isMobile || chatId) && (
              <div className="h-full min-w-0 flex-1 overflow-hidden">
                {selectedChat ? (
                  <ChatThread
                    chat={selectedChat}
                    highlightMessageId={(location.state as { highlightMessageId?: number } | null)?.highlightMessageId ?? null}
                    onBack={isMobile ? handleCloseChat : undefined}
                    onOpenSuggestions={isDesktop ? undefined : () => setIsSuggestionsOpen(true)}
                  />
                ) : chatId ? (
                  /* El lead todavía no llegó (entrada directa por URL o
                     recarga). En móvil la lista está oculta, así que sin esta
                     rama la pantalla quedaría sin salida. */
                  <div className="flex h-full flex-col items-center justify-center gap-4 bg-wa-app dark:bg-wa-panel-dark">
                    <Spinner label="Abriendo la conversación…" />
                    {isMobile && (
                      <Button variant="ghost" size="sm" onClick={handleCloseChat}>
                        Volver a la lista
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full gap-3 border-b-[6px] border-wa-primary bg-wa-app px-6 text-center text-wa-muted/50 dark:border-wa-primary/60 dark:bg-wa-panel-dark dark:text-wa-muted-dark/50">
                    <MessagesSquare className="w-12 h-12" strokeWidth={1.25} />
                    <p className="text-sm text-wa-muted dark:text-wa-muted-dark">Selecciona un lead para ver la conversación</p>
                  </div>
                )}
              </div>
            )}

            {/* Panel derecho — Sugerencias. Solo en escritorio: por debajo de
                1280px las tres columnas dejarían la conversación inusable, así
                que las sugerencias pasan a un panel deslizable. */}
            {isDesktop && (
              <div className="h-full w-96 shrink-0 overflow-hidden border-l border-wa-border bg-wa-app dark:border-wa-muted-dark/30 dark:bg-wa-panel-dark">
                {selectedChat ? (
                  renderSuggestionPanel(selectedChat)
                ) : (
                  <div className="flex flex-col items-center justify-center h-full gap-3 text-wa-muted/50 dark:text-wa-muted-dark/50">
                    <Sparkles className="w-12 h-12" strokeWidth={1.25} />
                    <p className="text-sm text-wa-muted dark:text-wa-muted-dark text-center px-6">Selecciona un lead para ver las sugerencias</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </Suspense>

      {previewChat && (
        <ChatPeekDialog
          chat={previewChat}
          onClose={() => setPreviewChat(null)}
          onOpen={() => {
            const chat = previewChat
            setPreviewChat(null)
            handleSelectChat(chat)
          }}
        />
      )}

      {/* Sugerencias como panel deslizable en móvil y tablet. */}
      <AnimatePresence>
        {!isDesktop && isSuggestionsOpen && selectedChat && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              onClick={() => setIsSuggestionsOpen(false)}
              /* aria-hidden y sin handler de teclado a propósito: un fondo de
                 modal no debe ser un punto de tabulación más. Quien navega con
                 teclado cierra con Escape (ver el handler de arriba). */
              aria-hidden="true"
              className="fixed inset-0 z-75 bg-black/40"
            />
            <motion.aside
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 32, stiffness: 320 }}
              aria-label="Sugerencias del lead"
              className="fixed inset-y-0 right-0 z-76 flex w-full max-w-md flex-col overflow-hidden border-l border-wa-border bg-wa-app pt-safe dark:border-wa-border-dark dark:bg-wa-panel-dark"
            >
              <div className="flex h-12 shrink-0 items-center justify-between border-b border-wa-border px-3 dark:border-wa-border-dark">
                <span className="text-sm font-semibold text-wa-text dark:text-wa-text-dark">Sugerencias</span>
                <button
                  type="button"
                  onClick={() => setIsSuggestionsOpen(false)}
                  aria-label="Cerrar sugerencias"
                  className="flex h-11 w-11 items-center justify-center rounded-lg text-wa-muted hover:bg-black/5 dark:text-wa-muted-dark dark:hover:bg-white/5"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden">
                <Suspense fallback={<PageLoader />}>{renderSuggestionPanel(selectedChat)}</Suspense>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Navegación inferior — solo en móvil, y no dentro de una conversación:
          ahí el espacio es para el composer y se vuelve con la flecha. */}
      {isMobile && !chatId && <MobileNavBar isAdmin={me?.role === 'admin'} unreadCount={unreadCount} />}
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
      <div className="flex h-full items-center justify-center bg-wa-app p-4 dark:bg-wa-app-dark">
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
      <div className="flex items-center justify-center h-full bg-wa-app dark:bg-wa-app-dark">
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
        <Route path="/reports" element={<MainLayout />} />
        <Route path="/templates" element={me.role === 'admin' ? <MainLayout /> : <Navigate to="/" replace />} />
        <Route path="/media-library" element={me.role === 'admin' ? <MainLayout /> : <Navigate to="/" replace />} />
        <Route path="/dashboard" element={me.role === 'admin' ? <MainLayout /> : <Navigate to="/" replace />} />
        <Route path="/automations" element={me.role === 'admin' ? <MainLayout /> : <Navigate to="/" replace />} />
        <Route path="/catalogs" element={me.role === 'admin' ? <MainLayout /> : <Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <MotionConfig reducedMotion="user">
        <AuthGate />
        <AppToaster />
        {/* Fuera del AuthGate: el service worker se registra aunque la sesión
            todavía no esté resuelta o el backend esté caído. */}
        <PwaUpdatePrompt />
      </MotionConfig>
    </QueryClientProvider>
  )
}

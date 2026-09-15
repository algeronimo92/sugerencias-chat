import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { BrowserRouter, Navigate, Outlet, Routes, Route, useLocation, useMatch, useNavigate } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { AnimatePresence, motion, MotionConfig } from 'motion/react'
import { AlertTriangle, Bug, Loader2, LogOut, MessageSquareLock, MessagesSquare, RefreshCw, Settings as SettingsIcon, ShieldCheck, Moon, Sun, X } from 'lucide-react'
import { EMPTY_CHAT_FILTERS } from './types'
import { ChatWorkspace } from './components/ChatWorkspace'
import { PageLoader } from './components/layout/PageLoader'
import { useLayoutContext, type LayoutContext, type SettingsTab } from './components/layout/layoutContext'
import { useChatFiltersState } from './hooks/useChatFiltersState'
import { useOpenChat } from './hooks/useOpenChat'
import { LoginPage } from './components/LoginPage'
import { MobileNavBar } from './components/MobileNavBar'
import { NotificationCenter } from './components/NotificationCenter'
import { PwaUpdatePrompt } from './components/PwaUpdatePrompt'
import { Sidebar } from './components/Sidebar'
import { useLayout } from './hooks/useBreakpoint'
import { useLogout, useMe } from './hooks/useAuth'
import { useUnreadCount } from './hooks/useChats'
import { useChatUpdates } from './hooks/useRealtime'
import type { InternalMentionAlert } from './hooks/useRealtime'
import { useNotifications } from './hooks/useNotifications'
import { useTheme } from './hooks/useTheme'
import { Button } from './components/ui/Button'
import { AppToaster } from './components/ui/Toaster'
import { Tooltip } from './components/ui/Tooltip'
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
const MyAutomationExecutionsPage = lazy(() =>
  import('./components/MyAutomationExecutionsPage').then(module => ({ default: module.MyAutomationExecutionsPage })),
)
const CatalogsPage = lazy(() =>
  import('./components/CatalogsPage').then(module => ({ default: module.CatalogsPage })),
)
const NewAppointmentPage = lazy(() =>
  import('./components/NewAppointmentPage').then(module => ({ default: module.NewAppointmentPage })),
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
function MainLayout() {
  const { data: me } = useMe()
  const { mutate: logout } = useLogout()
  const chatId = useMatch('/chat/:chatId')?.params.chatId ?? null
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
  const isMobile = useLayout() === 'mobile'
  const { theme, toggleTheme } = useTheme()
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isAccountSecurityOpen, setIsAccountSecurityOpen] = useState(false)
  const [isIssueReportOpen, setIsIssueReportOpen] = useState(false)
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTab>('claves')

  const layoutContext: LayoutContext = {
    chatFilters: useChatFiltersState(me?.id ?? null),
    openSettings,
    openIssueReport: () => setIsIssueReportOpen(true),
  }

  function openSettings(tab: SettingsTab = 'claves') {
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

  useChatUpdates(chatId ?? null, notify, showInternalMention)

  useEffect(() => {
    if (!internalMention) return
    const timeout = window.setTimeout(() => setInternalMention(null), 8000)
    return () => window.clearTimeout(timeout)
  }, [internalMention])

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
          <button
            type="button"
            onClick={() => logout(undefined, { onSettled: () => navigate('/') })}
            aria-label="Cerrar sesión"
            className={headerIconButtonClass}
          >
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

      <div className="flex flex-1 min-h-0 min-w-0">
        {!isMobile && <Sidebar isAdmin={me?.role === 'admin'} unreadCount={unreadCount} />}
        <div className="flex flex-1 min-h-0 min-w-0 flex-col overflow-hidden">
      <Suspense fallback={<PageLoader />}>
        <Outlet context={layoutContext} />
      </Suspense>
        </div>
      </div>

      {/* Navegación inferior — solo en móvil, y no dentro de una conversación:
          ahí el espacio es para el composer y se vuelve con la flecha. */}
      {isMobile && !chatId && <MobileNavBar isAdmin={me?.role === 'admin'} unreadCount={unreadCount} />}
    </div>
  )
}

function RequireAdmin({ isAdmin }: { isAdmin: boolean }) {
  const layoutContext = useLayoutContext()
  return isAdmin ? <Outlet context={layoutContext} /> : <Navigate to="/" replace />
}

function KanbanRoute() {
  const openChat = useOpenChat()
  return <KanbanBoard onOpenChat={openChat} />
}

function TasksRoute() {
  const navigate = useNavigate()
  return <TasksPage onOpenChat={(id) => navigate(`/chat/${id}`)} />
}

function IssueReportsRoute() {
  const { openIssueReport } = useLayoutContext()
  return <IssueReportsPage onCreate={openIssueReport} />
}

function DashboardRoute() {
  const navigate = useNavigate()
  const { chatFilters } = useLayoutContext()
  return (
    <DashboardPage
      onOpenTasks={() => navigate('/tasks')}
      onFilterChats={(filters) => {
        chatFilters.setChatFilter('all')
        chatFilters.setAdvancedFilters({ ...EMPTY_CHAT_FILTERS, ...filters })
        navigate('/')
      }}
    />
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
        <Route element={<MainLayout />}>
          <Route element={<ChatWorkspace />}>
            <Route index element={null} />
            <Route path="chat/:chatId" element={null} />
          </Route>
          <Route path="kanban" element={<KanbanRoute />} />
          <Route path="tasks" element={<TasksRoute />} />
          <Route path="reports" element={<IssueReportsRoute />} />
          <Route path="mis-flujos" element={<MyAutomationExecutionsPage />} />
          <Route path="citas/nueva" element={<NewAppointmentPage />} />
          <Route element={<RequireAdmin isAdmin={me.role === 'admin'} />}>
            <Route path="templates" element={<TemplatesPage />} />
            <Route path="media-library" element={<MediaLibraryPage />} />
            <Route path="dashboard" element={<DashboardRoute />} />
            <Route path="automations" element={<AutomationsPage />} />
            <Route path="catalogs" element={<CatalogsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
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

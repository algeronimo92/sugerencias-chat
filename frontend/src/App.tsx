import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  BrowserRouter,
  Navigate,
  Outlet,
  Routes,
  Route,
  useLocation,
  useMatch,
  useNavigate,
} from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  AnimatePresence,
  domAnimation,
  LazyMotion,
  m,
  MotionConfig,
} from "motion/react";
import {
  Bug,
  Loader2,
  LogOut,
  MessageSquareLock,
  Settings as SettingsIcon,
  ShieldCheck,
  Moon,
  Sun,
  X,
} from "lucide-react";
import { EMPTY_CHAT_FILTERS } from "./types";
import { useBrand } from "./branding";
import { BrandLogo } from "./components/BrandLogo";
import { BackendUnavailable } from "./components/BackendUnavailable";
import { ChatWorkspace } from "./components/ChatWorkspace";
import { PageLoader } from "./components/layout/PageLoader";
import {
  useLayoutContext,
  type LayoutContext,
  type SettingsTab,
} from "./components/layout/layoutContext";
import { useChatFiltersState } from "./hooks/useChatFiltersState";
import { useOpenChat } from "./hooks/useOpenChat";
import { MobileNavBar } from "./components/MobileNavBar";
import { NotificationCenter } from "./components/NotificationCenter";
import { PwaUpdatePrompt } from "./components/PwaUpdatePrompt";
import { Sidebar } from "./components/Sidebar";
import { useLayout } from "./hooks/useBreakpoint";
import { useLogout, useMe } from "./hooks/useAuth";
import { useUnreadCount } from "./hooks/useChats";
import { useChatUpdates } from "./hooks/useRealtime";
import type { InternalMentionAlert } from "./hooks/useRealtime";
import { useNotifications } from "./hooks/useNotifications";
import { useTheme } from "./hooks/useTheme";
import { AppToaster } from "./components/ui/Toaster";
import { Tooltip } from "./components/ui/Tooltip";
import { queryClient } from "./queryClient";

// Fuera del bundle del CRM: con sesión activa el login no se usa (y arrastra
// zod y react-hook-form), y el panel de plataforma solo se abre en /platform.
const LoginPage = lazy(() =>
  import("./components/LoginPage").then((module) => ({
    default: module.LoginPage,
  })),
);
const PlatformApp = lazy(() =>
  import("./platform/PlatformApp").then((module) => ({
    default: module.PlatformApp,
  })),
);
const AccountActionPage = lazy(() =>
  import("./components/AccountActionPage").then((module) => ({
    default: module.AccountActionPage,
  })),
);
const KanbanBoard = lazy(() =>
  import("./components/KanbanBoard").then((module) => ({
    default: module.KanbanBoard,
  })),
);
const TasksPage = lazy(() =>
  import("./components/TasksPage").then((module) => ({
    default: module.TasksPage,
  })),
);
const TemplatesPage = lazy(() =>
  import("./components/TemplatesPage").then((module) => ({
    default: module.TemplatesPage,
  })),
);
const DashboardPage = lazy(() =>
  import("./components/DashboardPage").then((module) => ({
    default: module.DashboardPage,
  })),
);
const MediaLibraryPage = lazy(() =>
  import("./components/MediaLibraryPage").then((module) => ({
    default: module.MediaLibraryPage,
  })),
);
const AutomationsPage = lazy(() =>
  import("./components/AutomationsPage").then((module) => ({
    default: module.AutomationsPage,
  })),
);
const MyAutomationExecutionsPage = lazy(() =>
  import("./components/MyAutomationExecutionsPage").then((module) => ({
    default: module.MyAutomationExecutionsPage,
  })),
);
const CatalogsPage = lazy(() =>
  import("./components/CatalogsPage").then((module) => ({
    default: module.CatalogsPage,
  })),
);
const AiAssistantPage = lazy(() =>
  import("./components/AiAssistantPage").then((module) => ({
    default: module.AiAssistantPage,
  })),
);
const NewAppointmentPage = lazy(() =>
  import("./components/NewAppointmentPage").then((module) => ({
    default: module.NewAppointmentPage,
  })),
);
const SettingsDialog = lazy(() =>
  import("./components/SettingsDialog").then((module) => ({
    default: module.SettingsDialog,
  })),
);
const AccountSecurityDialog = lazy(() =>
  import("./components/AccountSecurityDialog").then((module) => ({
    default: module.AccountSecurityDialog,
  })),
);
const IssueReportDialog = lazy(() =>
  import("./components/IssueReportDialog").then((module) => ({
    default: module.IssueReportDialog,
  })),
);
const IssueReportsPage = lazy(() =>
  import("./components/IssueReportsPage").then((module) => ({
    default: module.IssueReportsPage,
  })),
);
function MainLayout() {
  const brand = useBrand();
  const { data: me } = useMe();
  const { mutate: logout } = useLogout();
  const chatId = useMatch("/chat/:chatId")?.params.chatId ?? null;
  const navigate = useNavigate();

  // Cuando se hace clic en una notificación push con la app ya abierta en
  // otra pestaña, push-sw.js (frontend/public/push-sw.js) enfoca esa pestaña
  // y le manda la URL destino por postMessage en vez de navegar directo,
  // porque el service worker no tiene acceso al router de React. El
  // registro del SW vive en PwaUpdatePrompt, pero ese componente se monta
  // fuera del BrowserRouter (a propósito, para registrar el SW aunque la
  // sesión no esté resuelta) y no tiene `navigate`; por eso el listener del
  // mensaje vive acá, donde sí lo hay.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    function handleMessage(event: MessageEvent) {
      if (
        event.data?.type === "push-navigate" &&
        typeof event.data.url === "string"
      ) {
        navigate(event.data.url);
      }
    }
    navigator.serviceWorker.addEventListener("message", handleMessage);
    return () =>
      navigator.serviceWorker.removeEventListener("message", handleMessage);
  }, [navigate]);
  const location = useLocation();
  const isMobile = useLayout() === "mobile";
  const { theme, toggleTheme } = useTheme();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAccountSecurityOpen, setIsAccountSecurityOpen] = useState(false);
  const [isIssueReportOpen, setIsIssueReportOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] =
    useState<SettingsTab>("claves");

  const layoutContext: LayoutContext = {
    chatFilters: useChatFiltersState(me?.id ?? null),
    openSettings,
    openIssueReport: () => setIsIssueReportOpen(true),
  };

  function openSettings(tab: SettingsTab = "claves") {
    setSettingsInitialTab(tab);
    setIsSettingsOpen(true);
  }
  const { data: unreadCount = 0 } = useUnreadCount();
  const {
    permission: notificationPermission,
    requestPermission: requestNotificationPermission,
    notify,
  } = useNotifications(unreadCount);
  const [internalMention, setInternalMention] =
    useState<InternalMentionAlert | null>(null);
  const surfacedNotificationIdsRef = useRef(new Set<number>());

  function showInternalMention(alert: InternalMentionAlert) {
    if (surfacedNotificationIdsRef.current.has(alert.notificationId)) return;
    surfacedNotificationIdsRef.current.add(alert.notificationId);
    setInternalMention(alert);
  }

  useChatUpdates(chatId ?? null, notify, showInternalMention);

  useEffect(() => {
    if (!internalMention) return;
    const timeout = window.setTimeout(() => setInternalMention(null), 8000);
    return () => window.clearTimeout(timeout);
  }, [internalMention]);

  // La barra global usa la superficie más profunda; los encabezados de cada
  // columna usan wa-head-dark para que ambos niveles se distingan sin chocar.

  const headerIconButtonClass =
    "flex h-9 w-9 items-center justify-center rounded-xl text-wa-muted outline-none transition-colors hover:bg-wa-hover hover:text-wa-text focus-visible:ring-2 focus-visible:ring-wa-primary/60 dark:text-wa-muted-dark dark:hover:bg-wa-head-dark dark:hover:text-wa-text-dark";

  return (
    <div
      data-issue-capture-root
      className="flex h-full w-full min-w-0 max-w-full flex-col overflow-hidden bg-wa-app dark:bg-wa-app-dark"
    >
      {/* Barra superior — nivel global, más profundo que los headers locales. */}
      {/* min-h-12 y no h-12: con pt-safe la barra crece lo que mida el notch
          para que su verde llegue hasta el borde de la pantalla. */}
      <div className="flex min-h-14 w-full min-w-0 shrink-0 items-center gap-2 border-b border-wa-border bg-white px-3 pt-safe shadow-[0_1px_0_rgba(17,27,33,0.03)] sm:px-5 dark:border-wa-border-dark dark:bg-wa-panel-dark">
        <BrandLogo sizeClass="h-8 w-8" iconClass="h-4 w-4" />
        <span className="min-w-0 truncate text-sm font-bold tracking-[-0.02em] text-wa-text dark:text-white">
          {brand.name}
        </span>
        <span className="ml-1 hidden rounded-full bg-wa-primary/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-wa-primary-strong sm:inline dark:bg-wa-primary/15 dark:text-wa-primary">
          CRM
        </span>
        <span className="flex-1" />
        {me && (
          <button
            type="button"
            onClick={() => setIsAccountSecurityOpen(true)}
            className="mr-1 hidden items-center gap-2.5 rounded-xl border border-transparent px-2 py-1.5 text-left transition-colors hover:border-wa-border hover:bg-wa-hover lg:flex dark:hover:border-wa-border-dark dark:hover:bg-wa-head-dark"
            aria-label="Abrir acceso y seguridad"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-wa-primary/12 text-[11px] font-bold uppercase text-wa-primary-strong dark:bg-wa-primary/15 dark:text-wa-primary">
              {me.name.trim().charAt(0) || "U"}
            </span>
            <span>
              <span className="block max-w-36 truncate text-xs font-semibold leading-tight text-wa-text dark:text-wa-text-dark">
                {me.name}
              </span>
              <span className="block text-[9px] font-medium capitalize text-wa-muted dark:text-wa-muted-dark">
                {me.role === "admin" ? "Administrador" : "Vendedor"}
              </span>
            </span>
          </button>
        )}
        {me?.role === "admin" && (
          <Tooltip content="Configuración">
            <button
              type="button"
              onClick={() => openSettings("claves")}
              aria-label="Configuración"
              className={headerIconButtonClass}
            >
              <SettingsIcon className="w-4 h-4" />
            </button>
          </Tooltip>
        )}
        <Tooltip content="Reportar un problema">
          <button
            type="button"
            onClick={() => setIsIssueReportOpen(true)}
            aria-label="Reportar un problema"
            className="flex h-9 w-9 items-center justify-center rounded-xl text-wa-muted outline-none transition-colors hover:bg-red-50 hover:text-red-600 focus-visible:ring-2 focus-visible:ring-red-300/70 dark:text-wa-muted-dark dark:hover:bg-red-950/35 dark:hover:text-red-400"
          >
            <Bug className="h-4 w-4" />
          </button>
        </Tooltip>
        <Tooltip content="Acceso y seguridad">
          <button
            type="button"
            onClick={() => setIsAccountSecurityOpen(true)}
            aria-label="Acceso y seguridad"
            className={headerIconButtonClass}
          >
            <ShieldCheck className="h-4 w-4" />
          </button>
        </Tooltip>
        <NotificationCenter
          browserPermission={notificationPermission}
          onRequestBrowserPermission={requestNotificationPermission}
          onNewNotification={showInternalMention}
        />
        <Tooltip
          content={
            theme === "dark" ? "Activar modo claro" : "Activar modo oscuro"
          }
        >
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={
              theme === "dark" ? "Activar modo claro" : "Activar modo oscuro"
            }
            className={headerIconButtonClass}
          >
            {theme === "dark" ? (
              <Sun className="w-4 h-4" />
            ) : (
              <Moon className="w-4 h-4" />
            )}
          </button>
        </Tooltip>
        <Tooltip content="Cerrar sesión">
          <button
            type="button"
            onClick={() =>
              logout(undefined, { onSettled: () => navigate("/") })
            }
            aria-label="Cerrar sesión"
            className={headerIconButtonClass}
          >
            <LogOut className="w-4 h-4" />
          </button>
        </Tooltip>
      </div>

      {isSettingsOpen && (
        <Suspense fallback={null}>
          <SettingsDialog
            onClose={() => setIsSettingsOpen(false)}
            initialTab={settingsInitialTab}
          />
        </Suspense>
      )}
      {isAccountSecurityOpen && (
        <Suspense fallback={null}>
          <AccountSecurityDialog
            onClose={() => setIsAccountSecurityOpen(false)}
          />
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
          <m.div
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.18 }}
            className="fixed right-4 top-16 z-[70] w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-950 shadow-2xl dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
          >
            <div className="flex items-start gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-200 text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                <MessageSquareLock className="h-4 w-4" />
              </span>
              <button
                type="button"
                onClick={() => {
                  navigate(`/chat/${internalMention.leadId}`);
                  setInternalMention(null);
                }}
                className="min-w-0 flex-1 text-left"
              >
                <span className="block text-xs font-semibold">
                  {internalMention.authorName} te mencionó
                </span>
                <span className="mt-0.5 block line-clamp-2 text-xs text-amber-800/80 dark:text-amber-200/80">
                  {internalMention.content}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setInternalMention(null)}
                className="rounded p-1 text-amber-700 hover:bg-amber-100 dark:text-amber-400 dark:hover:bg-amber-900"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </m.div>
        )}
      </AnimatePresence>

      <div className="flex min-h-0 min-w-0 flex-1 bg-[#edf2f0] dark:bg-[#081216]">
        {!isMobile && (
          <Sidebar isAdmin={me?.role === "admin"} unreadCount={unreadCount} />
        )}
        <div className="flex flex-1 min-h-0 min-w-0 flex-col overflow-hidden">
          <Suspense fallback={<PageLoader />}>
            <Outlet context={layoutContext} />
          </Suspense>
        </div>
      </div>

      {/* Navegación inferior — solo en móvil, y no dentro de una conversación:
          ahí el espacio es para el composer y se vuelve con la flecha. */}
      {isMobile && !chatId && (
        <MobileNavBar
          isAdmin={me?.role === "admin"}
          unreadCount={unreadCount}
        />
      )}
    </div>
  );
}

function RequireAdmin({ isAdmin }: { isAdmin: boolean }) {
  const layoutContext = useLayoutContext();
  return isAdmin ? (
    <Outlet context={layoutContext} />
  ) : (
    <Navigate to="/" replace />
  );
}

function KanbanRoute() {
  const openChat = useOpenChat();
  return <KanbanBoard onOpenChat={openChat} />;
}

function TasksRoute() {
  const navigate = useNavigate();
  return <TasksPage onOpenChat={(id) => navigate(`/chat/${id}`)} />;
}

function IssueReportsRoute() {
  const { openIssueReport } = useLayoutContext();
  return <IssueReportsPage onCreate={openIssueReport} />;
}

function DashboardRoute() {
  const navigate = useNavigate();
  const { chatFilters } = useLayoutContext();
  return (
    <DashboardPage
      onOpenTasks={() => navigate("/tasks")}
      onFilterChats={(filters) => {
        chatFilters.setChatFilter("all");
        chatFilters.setAdvancedFilters({ ...EMPTY_CHAT_FILTERS, ...filters });
        navigate("/");
      }}
    />
  );
}

function AuthGate() {
  const { data: me, error, isError, isLoading, isFetching, refetch } = useMe();

  if (isError) {
    const detail =
      error instanceof Error && error.message !== "Network Error"
        ? error.message
        : "No se pudo establecer conexión con el servidor.";

    return (
      <BackendUnavailable
        detail={detail}
        isRetrying={isFetching}
        onRetry={refetch}
      />
    );
  }

  const fullScreenLoader = (
    <div className="flex items-center justify-center h-full bg-wa-app dark:bg-wa-app-dark">
      <Loader2 className="w-6 h-6 animate-spin text-wa-muted dark:text-wa-muted-dark" />
    </div>
  );

  if (isLoading || me === undefined) {
    return fullScreenLoader;
  }

  if (!me) {
    return (
      <Suspense fallback={fullScreenLoader}>
        <LoginPage />
      </Suspense>
    );
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
          <Route element={<RequireAdmin isAdmin={me.role === "admin"} />}>
            <Route path="templates" element={<TemplatesPage />} />
            <Route path="media-library" element={<MediaLibraryPage />} />
            <Route path="dashboard" element={<DashboardRoute />} />
            <Route path="automations" element={<AutomationsPage />} />
            <Route path="catalogs" element={<CatalogsPage />} />
            <Route path="ai-assistant" element={<AiAssistantPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default function App() {
  // El panel de plataforma no comparte nada con el CRM: ni sesión, ni cookie,
  // ni layout. Se decide por ruta antes del AuthGate porque en un host de
  // plataforma `/api/auth/me` devuelve 404 a propósito y la app mostraría la
  // pantalla de "backend no disponible" en vez del panel.
  if (window.location.pathname.startsWith("/platform")) {
    return (
      <QueryClientProvider client={queryClient}>
        <Suspense fallback={null}>
          <PlatformApp />
        </Suspense>
      </QueryClientProvider>
    );
  }

  if (["/accept-invitation", "/reset-password"].includes(window.location.pathname)) {
    return (
      <QueryClientProvider client={queryClient}>
        <Suspense fallback={null}>
          <AccountActionPage />
        </Suspense>
        <AppToaster />
      </QueryClientProvider>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <MotionConfig reducedMotion="user">
        {/* LazyMotion + m.* en vez de motion.*: solo se usan animaciones de
            entrada/salida, así que domAnimation alcanza y el motor completo
            queda fuera del bundle. strict falla si alguien usa motion.* */}
        <LazyMotion features={domAnimation} strict>
          <AuthGate />
          <AppToaster />
          {/* Fuera del AuthGate: el service worker se registra aunque la sesión
              todavía no esté resuelta o el backend esté caído. */}
          <PwaUpdatePrompt />
        </LazyMotion>
      </MotionConfig>
    </QueryClientProvider>
  );
}

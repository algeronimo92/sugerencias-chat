import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Outlet, useLocation, useMatch, useNavigate } from "react-router-dom";
import { AnimatePresence, m } from "motion/react";
import { MessageSquareLock, X } from "lucide-react";
import { toast } from "sonner";

import { useBrand } from "../shared/branding";
import { Avatar } from "../shared/ui/Avatar";
import { BrandLogo } from "../shared/ui/BrandLogo";
import { PageLoader } from "../shared/ui/PageLoader";
import { type IntegrationAnchor, type LayoutContext, type SettingsTab } from '../features/chats/public/layoutContext';
import { useChatFiltersState } from '../features/chats/public/useChatFiltersState';
import { MobileNavBar } from "./MobileNavBar";
import { roleLabel } from "./navigation";
import { PwaUpdateChip } from "./PwaUpdateChip";
import { CallCenterProvider, CallDock } from '../features/calls';
import { NotificationCenter } from '../features/notifications/public/NotificationCenter';
import { Sidebar } from "./Sidebar";
import { CommandPalette } from "./CommandPalette";
import { useLayout } from "../shared/hooks/useBreakpoint";
import { useLogout, useMe } from '../features/auth/public/queries';
import { useUnreadCount } from '../features/leads/public/queries'
import { useRealtimeConnection, type InternalMentionAlert } from "../realtime/useRealtime";
import { createAppRealtimeBus } from "./realtime";
import { useNotifications } from '../features/notifications/public/useNotifications';
import { useTheme } from "../shared/hooks/useTheme";
import { readGoogleCalendarReturn } from '../features/platform/public/googleCalendarReturn';
import { readEmailConnectReturn } from '../features/platform/public/emailConnectReturn';
import { OnboardingChecklist, OnboardingReopenButton } from '../features/platform/public/OnboardingChecklist';

const SettingsDialog = lazy(() =>
  import("../features/platform/public/SettingsDialog").then((module) => ({ default: module.SettingsDialog })),
);
const AccountSecurityDialog = lazy(() =>
  import("../features/auth/index").then((module) => ({ default: module.AccountSecurityDialog })),
);
const IssueReportDialog = lazy(() =>
  import("../features/issue-reports/dialog").then((module) => ({ default: module.IssueReportDialog })),
);
export function MainLayout() {
  const brand = useBrand();
  const { data: me } = useMe();
  const isAdmin = me?.role === "admin";
  // El analista solo mira el dashboard: sin chats no hay no leídos, tiempo
  // real, notificaciones ni reportes que mostrarle (ver navigation.ts).
  const isAnalyst = me?.role === "analista";
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
    useState<SettingsTab>("general");

  const layoutContext: LayoutContext = {
    chatFilters: useChatFiltersState(me?.id ?? null),
    openSettings,
    openIntegrations,
    openIssueReport: () => setIsIssueReportOpen(true),
  };

  function signOut() {
    logout(undefined, { onSettled: () => navigate("/") });
  }

  function openSettings(tab: SettingsTab = "general") {
    setSettingsInitialTab(tab);
    setIsSettingsOpen(true);
  }

  // Las conexiones con terceros (WhatsApp, calendario, ERP, voz, correo) tienen su
  // página: el diálogo de Configuración queda para los ajustes del CRM.
  function openIntegrations(anchor?: IntegrationAnchor) {
    setIsSettingsOpen(false);
    navigate(anchor ? `/integraciones#${anchor}` : "/integraciones");
  }

  // Vuelta de "Conectar con Google": el callback del backend redirige a
  // /?settings=calendar&google=... Se avisa el resultado, se abre la pestaña y
  // se limpia la URL para que recargar no repita el aviso.
  useEffect(() => {
    // Lo mismo con "Conectar con…" del correo (/?settings=email&email=...).
    const calendar = readGoogleCalendarReturn(location.search);
    const email = calendar ? null : readEmailConnectReturn(location.search);
    const result = calendar ?? email;
    if (!result) return;
    if (result.ok) toast.success(result.message);
    else toast.error(result.message);
    navigate(
      { pathname: "/integraciones", search: "", hash: calendar ? "#calendario" : "#correo" },
      { replace: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);
  const { data: unreadCount = 0 } = useUnreadCount(!isAnalyst);
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

  const realtimeBus = useMemo(createAppRealtimeBus, []);
  useRealtimeConnection(realtimeBus, notify, showInternalMention, { enabled: !isAnalyst });

  useEffect(() => {
    if (!internalMention) return;
    const timeout = window.setTimeout(() => setInternalMention(null), 8000);
    return () => window.clearTimeout(timeout);
  }, [internalMention]);

  const headerIconButtonClass =
    "flex h-10 w-10 items-center justify-center rounded-lg text-fg-muted outline-none transition-colors hover:bg-subtle hover:text-fg focus-visible:ring-2 focus-visible:ring-ring";

  const notificationCenter = (placement: "header" | "rail", expanded = false) =>
    isAnalyst ? null : (
      <NotificationCenter
        placement={placement}
        expanded={expanded}
        browserPermission={notificationPermission}
        onRequestBrowserPermission={requestNotificationPermission}
        onNewNotification={showInternalMention}
      />
    );

  return (
    <div
      data-issue-capture-root
      className="flex h-full w-full min-w-0 max-w-full flex-col overflow-hidden bg-canvas"
    >
      {/* Barra superior: solo en el celular. En tablet y escritorio el riel
          lateral lleva el logo, las notificaciones y la cuenta, y le devuelve
          56 px de alto al chat (doc 18 §5.1). Dentro de una conversación
          también se oculta en el celular: el hilo tiene su propia barra con la
          flecha para volver. min-h-14 y no h-14: con pt-safe crece lo que mida
          el notch. */}
      {isMobile && !chatId && (
        <div className="flex min-h-14 w-full min-w-0 shrink-0 items-center gap-2 border-b border-line bg-surface px-3 pt-safe">
          <BrandLogo sizeClass="h-8 w-8" iconClass="h-4 w-4" />
          <span className="min-w-0 truncate text-base font-semibold text-fg">
            {brand.name}
          </span>
          <PwaUpdateChip />
          <span className="flex-1" />
          {me && (
            <button
              type="button"
              onClick={() => setIsAccountSecurityOpen(true)}
              className="flex h-10 w-10 items-center justify-center rounded-lg outline-none hover:bg-subtle focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Abrir acceso y seguridad"
            >
              <Avatar name={me.name} size="sm" />
            </button>
          )}
          <OnboardingReopenButton enabled={isAdmin} className={headerIconButtonClass} />
          {/* Configuración, reportar, tema y cerrar sesión viven en "Más"
              (MobileNavBar). */}
          {notificationCenter("header")}
        </div>
      )}

      {/* Primeros pasos del negocio: solo admins y, en móvil, fuera de un
          chat, donde el espacio vertical es del composer. */}
      <OnboardingChecklist
        enabled={isAdmin && !(isMobile && chatId)}
        pathname={location.pathname}
        onOpenSettings={openSettings}
        onNavigate={(path) => navigate(path)}
        onOpenIntegrations={openIntegrations}
      />

      {isSettingsOpen && (
        <Suspense fallback={null}>
          <SettingsDialog
            onClose={() => setIsSettingsOpen(false)}
            initialTab={settingsInitialTab}
            onOpenIntegrations={() => openIntegrations()}
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

      {/* Llamadas de WhatsApp: el proveedor envuelve las pantallas (el botón
          Llamar del chat lo usa) y vive fuera de cualquier ruta, para que
          cambiar de pantalla no corte una llamada en curso. */}
      <CallCenterProvider>
      <CallDock />
      <div className="flex min-h-0 min-w-0 flex-1 bg-canvas">
        {!isMobile && (
          <Sidebar
            role={me?.role}
            unreadCount={unreadCount}
            brandName={brand.name}
            account={me ? { name: me.name, role: roleLabel(me.role), onOpenSecurity: () => setIsAccountSecurityOpen(true) } : null}
            theme={theme}
            onToggleTheme={toggleTheme}
            onLogout={signOut}
            onOpenSettings={isAdmin ? () => openSettings("general") : undefined}
            onOpenIssueReport={isAnalyst ? undefined : () => setIsIssueReportOpen(true)}
            renderNotifications={(expanded) => notificationCenter("rail", expanded)}
            extras={
              <>
                <PwaUpdateChip />
                <OnboardingReopenButton enabled={isAdmin} className={headerIconButtonClass} />
              </>
            }
          />
        )}
        <div className="flex flex-1 min-h-0 min-w-0 flex-col overflow-hidden">
          <Suspense fallback={<PageLoader />}>
            <Outlet context={layoutContext} />
          </Suspense>
        </div>
      </div>
      </CallCenterProvider>

      {/* Llamadas de WhatsApp: fuera de cualquier ruta, para que cambiar de
          pantalla no corte una llamada en curso. */}
      <CommandPalette
        role={me?.role}
        onOpenSettings={isAdmin ? () => openSettings("general") : undefined}
      />

      {/* Navegación inferior — solo en móvil, y no dentro de una conversación:
          ahí el espacio es para el composer y se vuelve con la flecha. */}
      {isMobile && !chatId && (
        <MobileNavBar
          role={me?.role}
          unreadCount={unreadCount}
          account={{
            onOpenSettings: isAdmin ? () => openSettings("general") : undefined,
            onOpenIssueReport: isAnalyst ? undefined : () => setIsIssueReportOpen(true),
            theme,
            onToggleTheme: toggleTheme,
            onLogout: signOut,
          }}
        />
      )}
    </div>
  );
}

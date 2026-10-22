import { lazy, Suspense, useState } from "react";
import { createBrowserRouter, createRoutesFromElements, Navigate, Outlet, Route, RouterProvider, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";

import { EMPTY_CHAT_FILTERS } from '../features/leads/types'
import { BackendUnavailable } from "../shared/ui/BackendUnavailable";
import { ChatWorkspace } from "../features/chats/page";
import { useLayoutContext } from '../features/chats/public/layoutContext';
import { useOpenChat } from '../features/chats/public/useOpenChat';
import { useMe } from '../features/auth/public/queries';
import { asApiError } from "../shared/http/errors";
import { extractErrorMessage } from "../shared/utils/errors";
import { MainLayout } from "./layout";
import { AccountActionProviders, CrmProviders, DataProviders } from "./providers";
import { RouteError } from "./RouteError";
// Fuera del bundle del CRM: con sesión activa el login no se usa (y arrastra
// zod y react-hook-form), y el panel de plataforma solo se abre en /platform.
const LoginPage = lazy(() =>
  import("../features/auth/index").then((module) => ({
    default: module.LoginPage,
  })),
);
const PlatformApp = lazy(() =>
  import("../features/platform/page").then((module) => ({
    default: module.PlatformApp,
  })),
);
const AccountActionPage = lazy(() =>
  import("../features/auth/index").then((module) => ({
    default: module.AccountActionPage,
  })),
);
const KanbanBoard = lazy(() =>
  import("../features/leads/page").then((module) => ({
    default: module.KanbanBoard,
  })),
);
const TasksPage = lazy(() =>
  import("../features/tasks/page").then((module) => ({
    default: module.TasksPage,
  })),
);
const TemplatesPage = lazy(() =>
  import("../features/templates/page").then((module) => ({
    default: module.TemplatesPage,
  })),
);
const DashboardPage = lazy(() =>
  import("../features/dashboard/page").then((module) => ({
    default: module.DashboardPage,
  })),
);
const MediaLibraryPage = lazy(() =>
  import("../features/media/page").then((module) => ({
    default: module.MediaLibraryPage,
  })),
);
const AutomationsPage = lazy(() =>
  import("../features/automations/admin-page").then((module) => ({
    default: module.AutomationsPage,
  })),
);
const MyAutomationExecutionsPage = lazy(() =>
  import("../features/automations/executions-page").then((module) => ({
    default: module.MyAutomationExecutionsPage,
  })),
);
const CatalogsPage = lazy(() =>
  import("./CatalogsPage").then((module) => ({
    default: module.CatalogsPage,
  })),
);
const AiAssistantPage = lazy(() =>
  import("../features/ai/page").then((module) => ({
    default: module.AiAssistantPage,
  })),
);
const NewAppointmentPage = lazy(() =>
  import("../features/appointments/page").then((module) => ({
    default: module.NewAppointmentPage,
  })),
);
const IssueReportsPage = lazy(() =>
  import("../features/issue-reports/page").then((module) => ({
    default: module.IssueReportsPage,
  })),
);
function useIsAdmin() {
  return useMe().data?.role === "admin";
}

function RequireAdmin() {
  const layoutContext = useLayoutContext();
  return useIsAdmin() ? (
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
  const isAdmin = useIsAdmin();
  const navigate = useNavigate();
  const { chatFilters } = useLayoutContext();
  return (
    <DashboardPage
      isAdmin={isAdmin}
      onOpenTasks={() => navigate("/tasks")}
      onOpenFlows={() => navigate("/mis-flujos")}
      onOpenChat={(leadId) => navigate(`/chat/${leadId}`)}
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
    const detail = asApiError(error)?.isNetwork
      ? "No se pudo establecer conexión con el servidor."
      : extractErrorMessage(error);

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

  return <CrmRouter />;
}

/** Las rutas del CRM. Cada nivel tiene su `errorElement`: si una pantalla se
 *  rompe, el aviso ocupa su lugar y el layout (barra lateral, chats) sigue. */
const crmRoutes = createRoutesFromElements(
  <Route element={<MainLayout />} errorElement={<RouteError />}>
    <Route errorElement={<RouteError />}>
      <Route element={<ChatWorkspace />}>
        <Route index element={null} />
        <Route path="chat/:chatId" element={null} />
      </Route>
      <Route path="kanban" element={<KanbanRoute />} />
      <Route path="tasks" element={<TasksRoute />} />
      <Route path="reports" element={<IssueReportsRoute />} />
      <Route path="mis-flujos" element={<MyAutomationExecutionsPage />} />
      <Route path="citas/nueva" element={<NewAppointmentPage />} />
      <Route path="dashboard" element={<DashboardRoute />} />
      <Route element={<RequireAdmin />}>
        <Route path="templates" element={<TemplatesPage />} />
        <Route path="media-library" element={<MediaLibraryPage />} />
        <Route path="automations" element={<AutomationsPage />} />
        <Route path="catalogs" element={<CatalogsPage />} />
        <Route path="ai-assistant" element={<AiAssistantPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Route>
  </Route>,
);

function CrmRouter() {
  // Uno por sesión: se crea al entrar y se descarta con el login.
  const [router] = useState(() => createBrowserRouter(crmRoutes));
  return <RouterProvider router={router} />;
}

export function AppRoutes() {
  if (window.location.pathname.startsWith("/platform")) {
    return (
      <DataProviders>
        <Suspense fallback={null}>
          <PlatformApp />
        </Suspense>
      </DataProviders>
    );
  }

  if (["/accept-invitation", "/reset-password"].includes(window.location.pathname)) {
    return (
      <AccountActionProviders>
        <Suspense fallback={null}>
          <AccountActionPage />
        </Suspense>
      </AccountActionProviders>
    );
  }

  return (
    <CrmProviders>
      <AuthGate />
    </CrmProviders>
  );
}

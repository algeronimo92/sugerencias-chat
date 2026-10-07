import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Outlet, Route, Routes, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";

import { EMPTY_CHAT_FILTERS } from '../features/leads/types'
import { BackendUnavailable } from "../shared/ui/BackendUnavailable";
import { ChatWorkspace } from "../features/chats/components/ChatWorkspace";
import { useLayoutContext } from "../features/chats/layoutContext";
import { useOpenChat } from "../features/chats/useOpenChat";
import { useMe } from "../features/auth/queries";
import { MainLayout } from "./layout";
import { AccountActionProviders, CrmProviders, DataProviders } from "./providers";
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
  import("../features/dashboard/components/DashboardPage").then((module) => ({
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
  import("../features/platform/components/CatalogsPage").then((module) => ({
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

function DashboardRoute({ isAdmin }: { isAdmin: boolean }) {
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
          <Route path="dashboard" element={<DashboardRoute isAdmin={me.role === "admin"} />} />
          <Route element={<RequireAdmin isAdmin={me.role === "admin"} />}>
            <Route path="templates" element={<TemplatesPage />} />
            <Route path="media-library" element={<MediaLibraryPage />} />
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

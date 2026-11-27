import { lazy, Suspense, useState, type ComponentProps } from "react";
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
import { can, type Permission } from "../shared/permissions";
import { canSeeDashboard, homePathFor } from "./navigation";
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
const ContactsPage = lazy(() =>
  import("../features/contacts/page").then((module) => ({
    default: module.ContactsPage,
  })),
);
const TemplatesPage = lazy(() =>
  import("../features/templates/page").then((module) => ({
    default: module.TemplatesPage,
  })),
);
const TemplateEditorPage = lazy(() =>
  import("../features/templates/page").then((module) => ({
    default: module.TemplateEditorPage,
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
const IntegrationsPage = lazy(() =>
  import("./IntegrationsPage").then((module) => ({
    default: module.IntegrationsPage,
  })),
);
const SettingsPage = lazy(() =>
  import("../features/platform/settings-page").then((module) => ({
    default: module.SettingsPage,
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
// Confirmar una cita cambiada en el calendario: llega desde su notificación.
const AppointmentChangePage = lazy(() =>
  import("../features/appointments/page").then((module) => ({
    default: module.AppointmentChangePage,
  })),
);
// El panel de "Separar cita" de la agenda: se baja recién al abrirlo.
const LeadAppointmentLauncher = lazy(() =>
  import("../features/appointments/public/LeadAppointmentLauncher").then((module) => ({
    default: module.LeadAppointmentLauncher,
  })),
);
const IssueReportsPage = lazy(() =>
  import("../features/issue-reports/page").then((module) => ({
    default: module.IssueReportsPage,
  })),
);
/** La "bandeja" de cada quien: los chats, o el dashboard para quien no los
 *  ve (por defecto, el analista). */
function HomeRedirect() {
  return <Navigate to={homePathFor(useMe().data)} replace />;
}

/** Deja pasar a quien tenga alguno de `anyOf`; si no, a su bandeja. Un enlace
 *  guardado no debe dejar a nadie frente al 403 del backend. */
function RequirePermission({ anyOf }: { anyOf: Permission[] }) {
  const layoutContext = useLayoutContext();
  return can(useMe().data, ...anyOf) ? (
    <Outlet context={layoutContext} />
  ) : (
    <HomeRedirect />
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

// Suspense propio: mientras baja el panel, la agenda sigue a la vista en vez
// de cambiarse por el cargador de la ruta.
function ContactAppointmentPanel(props: ComponentProps<typeof LeadAppointmentLauncher>) {
  return (
    <Suspense fallback={null}>
      <LeadAppointmentLauncher {...props} />
    </Suspense>
  );
}

function ContactsRoute() {
  const navigate = useNavigate();
  return (
    <ContactsPage
      onOpenChat={(id) => navigate(`/chat/${id}`)}
      AppointmentPanel={ContactAppointmentPanel}
    />
  );
}

function IssueReportsRoute() {
  const { openIssueReport } = useLayoutContext();
  return <IssueReportsPage onCreate={openIssueReport} />;
}

function DashboardRoute() {
  const { data: me } = useMe();
  const navigate = useNavigate();
  const { chatFilters } = useLayoutContext();
  // Un enlace guardado o compartido no puede dejar al vendedor frente a un
  // error: el backend le niega el dashboard, así que vuelve a su bandeja.
  if (!canSeeDashboard(me)) return <HomeRedirect />;
  return (
    <DashboardPage
      viewer={me}
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
      <Route path="dashboard" element={<DashboardRoute />} />
      <Route path="reports" element={<IssueReportsRoute />} />
      <Route element={<RequirePermission anyOf={["conversations.view"]} />}>
        <Route element={<ChatWorkspace />}>
          <Route index element={null} />
          <Route path="chat/:chatId" element={null} />
        </Route>
      </Route>
      <Route element={<RequirePermission anyOf={["leads.view"]} />}>
        <Route path="kanban" element={<KanbanRoute />} />
      </Route>
      <Route element={<RequirePermission anyOf={["tasks.use"]} />}>
        <Route path="tasks" element={<TasksRoute />} />
      </Route>
      <Route element={<RequirePermission anyOf={["contacts.view"]} />}>
        <Route path="contacts" element={<ContactsRoute />} />
      </Route>
      <Route element={<RequirePermission anyOf={["automations.run"]} />}>
        <Route path="mis-flujos" element={<MyAutomationExecutionsPage />} />
      </Route>
      <Route element={<RequirePermission anyOf={["appointments.edit"]} />}>
        <Route path="citas/nueva" element={<NewAppointmentPage />} />
        <Route path="citas/:appointmentId/cambio" element={<AppointmentChangePage />} />
      </Route>
      <Route element={<RequirePermission anyOf={["templates.manage"]} />}>
        <Route path="templates" element={<TemplatesPage />} />
        <Route path="templates/nueva" element={<TemplateEditorPage />} />
        <Route path="templates/:templateId" element={<TemplateEditorPage />} />
      </Route>
      <Route element={<RequirePermission anyOf={["media_library.manage"]} />}>
        <Route path="media-library" element={<MediaLibraryPage />} />
      </Route>
      <Route element={<RequirePermission anyOf={["automations.manage"]} />}>
        <Route path="automations" element={<AutomationsPage />} />
      </Route>
      <Route element={<RequirePermission anyOf={["catalogs.manage"]} />}>
        <Route path="catalogs" element={<CatalogsPage />} />
      </Route>
      <Route element={<RequirePermission anyOf={["settings.manage"]} />}>
        <Route path="integraciones" element={<IntegrationsPage />} />
      </Route>
      <Route element={<RequirePermission anyOf={["settings.manage", "users.manage"]} />}>
        <Route path="configuracion" element={<SettingsPage />} />
        <Route path="configuracion/:section" element={<SettingsPage />} />
      </Route>
      <Route element={<RequirePermission anyOf={["ai.configure"]} />}>
        <Route path="ai-assistant" element={<AiAssistantPage />} />
      </Route>
      <Route path="*" element={<HomeRedirect />} />
    </Route>
  </Route>,
);

function CrmRouter() {
  // Uno por sesión: se crea al entrar y se descarta con el login. Se crea una
  // sola vez por montaje (inicializador de useState), no en cada render. A
  // nivel de módulo, como pide la regla, sobreviviría al logout y quien entre
  // con otra cuenta seguiría en la ruta (el chat) del usuario anterior.
  // react-doctor-disable-next-line react-router-no-router-in-render
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

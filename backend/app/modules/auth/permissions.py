"""Catálogo de permisos y qué puede hacer cada rol.

Los roles son fijos (``UserRole``). Lo que el negocio decide es qué permisos
tiene cada rol: la matriz vive en ``role_permissions`` (un schema por negocio)
y el admin la edita desde ``/api/roles``. El catálogo, en cambio, es código:
un permiso nuevo necesita su ruta o su regla, así que llega con una migración
que lo inserta en ``permissions`` y, si corresponde, se lo da a los roles.

- ``admin`` tiene siempre todos los permisos y su fila no se edita: así nadie
  puede dejar al negocio sin quien administre usuarios o la matriz misma.
- Los permisos ``admin_only`` no se pueden dar a otro rol. Gestionar usuarios
  o la matriz equivaldría a poder hacerse admin; la configuración del negocio
  maneja credenciales de Meta, del correo y de Google.

Cada ruta de negocio declara su permiso con ``require_permission``. Las que
solo sostienen la propia cuenta están en ``SELF_SERVICE_ROUTES`` de
``tests/test_route_security.py``: una ruta nueva sin permiso hace fallar CI en
vez de quedar abierta para todo el que inicie sesión (lo que antes resolvía
la lista cerrada de rutas del analista).
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol

from app.modules.auth.types import UserRole


class Permission(StrEnum):
    DASHBOARD_VIEW = "dashboard.view"
    DASHBOARD_VIEW_MEMBER = "dashboard.view_member"
    DASHBOARD_EXPORT = "dashboard.export"
    DASHBOARD_EXPORT_PERSONAL_DATA = "dashboard.export_personal_data"

    LEADS_VIEW = "leads.view"
    LEADS_VIEW_ALL = "leads.view_all"
    LEADS_EDIT = "leads.edit"
    LEADS_ASSIGN = "leads.assign"
    LEADS_MERGE = "leads.merge"
    LEADS_DELETE = "leads.delete"

    CONVERSATIONS_VIEW = "conversations.view"
    CONVERSATIONS_SEND = "conversations.send"
    CALLS_HANDLE = "calls.handle"
    TEAM_SUPERVISE = "team.supervise"

    TASKS_USE = "tasks.use"

    APPOINTMENTS_VIEW = "appointments.view"
    APPOINTMENTS_EDIT = "appointments.edit"
    APPOINTMENTS_MANAGE = "appointments.manage"
    APPOINTMENTS_CONFIGURE = "appointments.configure"

    CONTACTS_VIEW = "contacts.view"
    CONTACTS_EDIT = "contacts.edit"
    CONTACTS_DELETE = "contacts.delete"
    CONTACTS_IMPORT = "contacts.import"

    AUTOMATIONS_RUN = "automations.run"
    AUTOMATIONS_MANAGE = "automations.manage"

    TEMPLATES_USE = "templates.use"
    TEMPLATES_MANAGE = "templates.manage"
    CATALOGS_MANAGE = "catalogs.manage"
    MEDIA_LIBRARY_MANAGE = "media_library.manage"
    AI_CONFIGURE = "ai.configure"
    ISSUE_REPORTS_MANAGE = "issue_reports.manage"

    SETTINGS_MANAGE = "settings.manage"
    USERS_MANAGE = "users.manage"


@dataclass(frozen=True)
class PermissionInfo:
    group: str
    label: str
    admin_only: bool = False


P = Permission

# Lo que se muestra en la matriz. Debe tener una entrada por permiso (lo
# comprueba un test) y coincidir con las filas de ``permissions`` que
# insertan las migraciones.
PERMISSION_INFO: dict[Permission, PermissionInfo] = {
    P.DASHBOARD_VIEW: PermissionInfo("dashboard", "Ver el dashboard del equipo"),
    P.DASHBOARD_VIEW_MEMBER: PermissionInfo("dashboard", "Ver el dashboard de otra persona del equipo"),
    P.DASHBOARD_EXPORT: PermissionInfo("dashboard", "Exportar reportes sin datos de pacientes"),
    P.DASHBOARD_EXPORT_PERSONAL_DATA: PermissionInfo("dashboard", "Exportar reportes con datos de pacientes"),
    P.LEADS_VIEW: PermissionInfo("leads", "Ver leads, el kanban y las notificaciones"),
    P.LEADS_VIEW_ALL: PermissionInfo("leads", "Ver también los leads de otros y los sin asignar"),
    P.LEADS_EDIT: PermissionInfo("leads", "Crear leads y editar sus datos, etapa y etiquetas"),
    P.LEADS_ASSIGN: PermissionInfo("leads", "Asignar leads a otra persona"),
    P.LEADS_MERGE: PermissionInfo("leads", "Unir leads duplicados"),
    P.LEADS_DELETE: PermissionInfo("leads", "Eliminar leads"),
    P.CONVERSATIONS_VIEW: PermissionInfo("conversations", "Leer los chats y sus notas"),
    P.CONVERSATIONS_SEND: PermissionInfo("conversations", "Escribir y enviar mensajes, y usar las sugerencias de IA"),
    P.CALLS_HANDLE: PermissionInfo("conversations", "Atender y hacer llamadas de WhatsApp"),
    P.TEAM_SUPERVISE: PermissionInfo(
        "conversations", "Actuar sobre lo de otros: tareas, notas, mensajes programados, llamadas y automatizaciones"
    ),
    P.TASKS_USE: PermissionInfo("tasks", "Ver y gestionar tareas"),
    P.APPOINTMENTS_VIEW: PermissionInfo("appointments", "Ver la agenda de citas"),
    P.APPOINTMENTS_EDIT: PermissionInfo("appointments", "Crear y editar citas"),
    P.APPOINTMENTS_MANAGE: PermissionInfo("appointments", "Descartar y restaurar citas, y probar avisos"),
    P.APPOINTMENTS_CONFIGURE: PermissionInfo("appointments", "Configurar avisos de cita y el calendario"),
    P.CONTACTS_VIEW: PermissionInfo("contacts", "Ver la agenda de contactos"),
    P.CONTACTS_EDIT: PermissionInfo("contacts", "Crear y editar contactos"),
    P.CONTACTS_DELETE: PermissionInfo("contacts", "Eliminar contactos"),
    P.CONTACTS_IMPORT: PermissionInfo("contacts", "Importar contactos y pasarlos al embudo en bloque"),
    P.AUTOMATIONS_RUN: PermissionInfo("automations", "Lanzar automatizaciones desde el chat y seguir sus ejecuciones"),
    P.AUTOMATIONS_MANAGE: PermissionInfo("automations", "Crear, editar y publicar automatizaciones"),
    P.TEMPLATES_USE: PermissionInfo("catalogs", "Usar plantillas y respuestas rápidas"),
    P.TEMPLATES_MANAGE: PermissionInfo("catalogs", "Crear y editar plantillas y sus categorías"),
    P.CATALOGS_MANAGE: PermissionInfo("catalogs", "Editar servicios, etiquetas, campos y etapas"),
    P.MEDIA_LIBRARY_MANAGE: PermissionInfo("catalogs", "Editar la biblioteca de archivos"),
    P.AI_CONFIGURE: PermissionInfo("settings", "Configurar el asistente de IA"),
    P.ISSUE_REPORTS_MANAGE: PermissionInfo("settings", "Gestionar los reportes de problemas del equipo"),
    P.SETTINGS_MANAGE: PermissionInfo("settings", "Configurar el negocio e integraciones", admin_only=True),
    P.USERS_MANAGE: PermissionInfo("settings", "Gestionar usuarios y permisos de los roles", admin_only=True),
}

ALL_PERMISSIONS: frozenset[str] = frozenset(Permission)
GRANTABLE_PERMISSIONS: frozenset[str] = frozenset(
    permission for permission, info in PERMISSION_INFO.items() if not info.admin_only
)
# Roles cuya fila de la matriz se edita. ``admin`` queda fuera: tiene todo.
EDITABLE_ROLES: tuple[str, ...] = (UserRole.SELLER, UserRole.ANALYST)

# Lo que siembra la migración que creó la matriz, igual a lo que cada rol
# podía hacer antes de que existiera. Sirve también de respaldo para usuarios
# que no pasaron por ``get_current_user`` (dobles de test, workers).
# ``leads.view_all`` del vendedor dependía del ajuste
# ``sellers_see_only_assigned_leads``: la migración lo respeta por negocio.
DEFAULT_ROLE_PERMISSIONS: dict[str, frozenset[str]] = {
    UserRole.ADMIN: ALL_PERMISSIONS,
    UserRole.SELLER: frozenset({
        P.LEADS_VIEW, P.LEADS_VIEW_ALL, P.LEADS_EDIT,
        P.CONVERSATIONS_VIEW, P.CONVERSATIONS_SEND, P.CALLS_HANDLE,
        P.TASKS_USE,
        P.APPOINTMENTS_VIEW, P.APPOINTMENTS_EDIT,
        P.CONTACTS_VIEW, P.CONTACTS_EDIT,
        P.AUTOMATIONS_RUN,
        P.TEMPLATES_USE,
    }),
    UserRole.ANALYST: frozenset({P.DASHBOARD_VIEW, P.DASHBOARD_EXPORT}),
}


class HasRole(Protocol):
    role: str


def can(user: HasRole, *permissions: str) -> bool:
    """Si ``user`` tiene alguno de ``permissions``.

    ``get_current_user`` deja en ``user.permissions`` la fila vigente de la
    matriz. Un usuario que no pasó por ahí cae a los permisos por defecto de su
    rol; nunca a "todo".
    """
    if user.role == UserRole.ADMIN:
        return True
    granted = getattr(user, "permissions", None)
    if granted is None:
        granted = DEFAULT_ROLE_PERMISSIONS.get(user.role, frozenset())
    return any(permission in granted for permission in permissions)

"""Cómo se traduce la matriz de permisos a privilegios de PostgreSQL.

La app decide por permiso (qué pantallas y acciones); la base pone la
segunda barrera con sus propios roles. Si una ruta olvida su guard, o un bug
intenta escribir donde ese rol no puede, PostgreSQL lo rechaza igual.

- Roles de PostgreSQL: tres por negocio, uno por rol de la app
  (``cv_<id>_admin``, ``cv_<id>_vendedor``, ``cv_<id>_analista``), ``NOLOGIN`` y
  sin ningún atributo de sistema. Solo tienen privilegios en el schema de su
  negocio: la base impide cruzar datos entre clínicas. La conexión del
  backend es miembro de todos y en cada transacción de una petición hace
  ``SET LOCAL ROLE`` según el usuario y el negocio (``app/db/session.py``).
- Privilegios de sistema: crear, alterar o borrar objetos (``CREATE`` sobre el
  schema, DDL) queda solo para el dueño, que es quien migra. Los roles de la
  app reciben ``USAGE`` sobre el schema y nada más.
- Privilegios de objeto: ``SELECT``, ``INSERT``, ``UPDATE`` y ``DELETE`` por
  tabla. Cada permiso declara los que necesita (``PERMISSION_OBJECT_PRIVILEGES``)
  y lo que recibe un rol es la unión de los de sus permisos más
  ``BASE_OBJECT_PRIVILEGES``. El admin recibe todo el DML de su schema.

El reparto es por grupo de tablas (``@leads`` = las de ``app/db/models/leads.py``)
o por tabla. Lo que la base no puede saber, como "solo los leads asignados" o
"solo sus propias tareas", lo sigue decidiendo la app por fila.

Limitación conocida: ``SET LOCAL ROLE`` lo puede deshacer quien ejecute SQL
arbitrario en la conexión (``RESET ROLE``). La barrera protege de errores de la
app, no de una inyección SQL; para eso haría falta un pool por rol con login.
"""

from __future__ import annotations

from app.modules.auth.permissions import Permission as P
from app.modules.auth.types import UserRole

# Rol de la app → sufijo del rol de base del negocio (ver app/db/privileges.py).
DB_ROLES: dict[str, str] = {
    UserRole.ADMIN: "admin",
    UserRole.SELLER: "vendedor",
    UserRole.ANALYST: "analista",
}

SELECT, INSERT, UPDATE, DELETE = "SELECT", "INSERT", "UPDATE", "DELETE"
READ = frozenset({SELECT})
WRITE = frozenset({SELECT, INSERT, UPDATE})
ALL = frozenset({SELECT, INSERT, UPDATE, DELETE})

# Tablas de cada schema de negocio, por el archivo de modelos que las define.
# Un test exige que estén todas: una tabla nueva sin grupo quedaría sin
# privilegios para nadie salvo el dueño.
TABLE_GROUPS: dict[str, tuple[str, ...]] = {
    "ai": ("ai_jobs", "knowledge_documents", "knowledge_document_services", "ai_profile", "knowledge_chunks"),
    "appointments": ("appointments", "appointment_notices"),
    "auth": (
        "roles", "permissions", "role_permissions", "users", "auth_login_throttles", "admin_totp",
        "admin_totp_recovery_codes", "auth_action_tokens", "email_notification_log", "trusted_devices",
        "auth_sessions",
    ),
    "automations": ("automation_rules", "automation_flow_versions", "automation_round_robin_state", "automation_executions"),
    "catalogs": (
        "lead_tags", "lead_services", "service_packages", "template_categories", "custom_field_definitions",
        "message_templates", "template_user_state", "template_attachments",
    ),
    "contacts": (
        "contacts", "contact_import_batches", "contact_import_rows", "whatsapp_app_syncs",
        "whatsapp_history_chunks", "contact_settings",
    ),
    "conversations": (
        "wsp_messages", "whatsapp_message_events", "whatsapp_entry_point_windows", "message_outbox",
        "scheduled_messages", "whatsapp_calls",
    ),
    "leads": (
        "leads", "whatsapp_identities", "wsp_ad", "meta_conversion_events", "lead_stages",
        "lead_tag_assignments", "lead_activity", "lead_notes", "lead_note_mentions",
        "lead_assignment_turns", "data_exports",
    ),
    "media": ("media_assets",),
    "notifications": ("user_notifications", "push_subscriptions"),
    "platform": ("whatsapp_pricing_daily",),
    "reports": ("issue_reports", "issue_report_attachments", "issue_report_comments", "issue_report_events"),
    "settings": ("app_settings",),
    "tasks": ("lead_tasks",),
}

# Plano de control (schema public): lo que una petición de negocio lee para
# saber de qué negocio es, su marca y su conexión de WhatsApp. Los usuarios y
# sesiones del panel de plataforma no se leen nunca desde un negocio.
CONTROL_READ_TABLES: tuple[str, ...] = (
    "organizations", "organization_branding", "organization_domains", "whatsapp_connections",
    "tenant_schema_versions", "platform_settings", "knowledge_templates",
)

Grants = dict[str, frozenset[str]]

# Lo que necesita cualquiera que inicia sesión: sostener su sesión y su
# dispositivo, cambiar su contraseña (solo esa columna de ``users``), leer la
# matriz y la configuración, y reportar problemas de la app.
BASE_OBJECT_PRIVILEGES: Grants = {
    "users": READ,
    "users.password_hash": frozenset({UPDATE}),
    "auth_sessions": ALL,
    "trusted_devices": ALL,
    "auth_login_throttles": ALL,
    "email_notification_log": WRITE,
    "roles": READ,
    "permissions": READ,
    "role_permissions": READ,
    "@settings": READ,
    "@reports": WRITE,
}

_DASHBOARD_READS: Grants = {
    "@leads": READ, "@conversations": READ, "@appointments": READ, "@automations": READ,
    "@catalogs": READ, "@tasks": READ, "@contacts": READ, "@platform": READ,
}

PERMISSION_OBJECT_PRIVILEGES: dict[P, Grants] = {
    P.DASHBOARD_VIEW: _DASHBOARD_READS,
    P.DASHBOARD_VIEW_MEMBER: _DASHBOARD_READS,
    # Cada exportación queda registrada (``data_exports``).
    P.DASHBOARD_EXPORT: {**_DASHBOARD_READS, "data_exports": WRITE},
    P.DASHBOARD_EXPORT_PERSONAL_DATA: {**_DASHBOARD_READS, "data_exports": WRITE},
    P.LEADS_VIEW: {
        "@leads": READ, "@catalogs": READ, "@conversations": READ, "@tasks": READ, "@appointments": READ,
        "@automations": READ, "@media": READ, "@contacts": READ, "@ai": READ, "@notifications": ALL,
    },
    # Qué filas ve lo decide la app: a la base le da igual.
    P.LEADS_VIEW_ALL: {},
    # Mover de etapa o editar dispara automatizaciones, tareas y mensajes del sistema.
    P.LEADS_EDIT: {
        "@leads": WRITE, "lead_tag_assignments": ALL, "@automations": WRITE, "@tasks": WRITE,
        "@conversations": WRITE, "@contacts": WRITE,
    },
    P.LEADS_ASSIGN: {"@leads": WRITE},
    # Unir mueve el historial del lead que se borra al que queda.
    P.LEADS_MERGE: {
        "@leads": ALL, "@conversations": WRITE, "@tasks": WRITE, "@appointments": WRITE,
        "@automations": WRITE, "@contacts": WRITE,
    },
    # El resto del historial cae por ON DELETE CASCADE, que corre como dueño.
    P.LEADS_DELETE: {"@leads": ALL, "@contacts": WRITE},
    # Abrir el chat marca leído (contador en ``leads``) y las menciones vistas.
    P.CONVERSATIONS_VIEW: {
        "@conversations": READ, "@leads": frozenset({SELECT, UPDATE}), "@media": READ,
        "lead_notes": READ, "lead_note_mentions": frozenset({SELECT, UPDATE}),
    },
    P.CONVERSATIONS_SEND: {
        "@conversations": ALL, "@leads": WRITE, "lead_notes": ALL, "lead_note_mentions": ALL,
        "@media": WRITE, "@ai": WRITE, "@automations": WRITE, "template_user_state": ALL,
        "@notifications": ALL,
    },
    P.CALLS_HANDLE: {"@conversations": WRITE, "@leads": frozenset({SELECT, UPDATE})},
    # Actuar sobre lo de otros es una regla por fila: la decide la app.
    P.TEAM_SUPERVISE: {},
    P.TASKS_USE: {"@tasks": ALL, "@leads": READ, "@notifications": ALL},
    P.APPOINTMENTS_VIEW: {"@appointments": READ, "@leads": READ, "@catalogs": READ},
    # Agendar puede crear el lead, avisar por WhatsApp y disparar flujos.
    P.APPOINTMENTS_EDIT: {
        "@appointments": WRITE, "@leads": WRITE, "@conversations": WRITE, "@automations": WRITE,
        "@contacts": WRITE, "@notifications": ALL, "@media": WRITE,
    },
    P.APPOINTMENTS_MANAGE: {"@appointments": WRITE},
    P.APPOINTMENTS_CONFIGURE: {"@appointments": ALL, "@settings": WRITE},
    P.CONTACTS_VIEW: {"@contacts": READ},
    P.CONTACTS_EDIT: {"@contacts": WRITE, "@leads": WRITE},
    P.CONTACTS_DELETE: {"@contacts": ALL},
    P.CONTACTS_IMPORT: {"@contacts": ALL, "@leads": WRITE},
    P.AUTOMATIONS_RUN: {"@automations": WRITE, "@conversations": WRITE, "@leads": frozenset({SELECT, UPDATE})},
    P.AUTOMATIONS_MANAGE: {"@automations": ALL},
    # Las plantillas personales y los favoritos son filas propias.
    P.TEMPLATES_USE: {"@catalogs": READ, "message_templates": WRITE, "template_user_state": ALL, "@media": READ},
    P.TEMPLATES_MANAGE: {"@catalogs": ALL, "@media": ALL},
    P.CATALOGS_MANAGE: {"@catalogs": ALL, "@leads": WRITE},
    P.MEDIA_LIBRARY_MANAGE: {"@media": ALL},
    P.AI_CONFIGURE: {"@ai": ALL, "@media": ALL, "@settings": WRITE},
    P.ISSUE_REPORTS_MANAGE: {"@reports": ALL},
    P.SETTINGS_MANAGE: {"@settings": ALL, "@platform": ALL},
    P.USERS_MANAGE: {"@auth": ALL},
}


def _expand(grants: Grants) -> dict[str, set[str]]:
    """``@grupo`` a sus tablas; ``tabla.columna`` queda como está."""
    expanded: dict[str, set[str]] = {}
    for target, privileges in grants.items():
        tables = TABLE_GROUPS[target[1:]] if target.startswith("@") else (target,)
        for table in tables:
            expanded.setdefault(table, set()).update(privileges)
    return expanded


def object_privileges_for(role: str, permissions: frozenset[str]) -> dict[str, frozenset[str]]:
    """Privilegios de objeto que corresponden a ``role`` con ``permissions``:
    ``{"tabla": {...}, "tabla.columna": {...}}``. El admin, todo el DML."""
    if role == UserRole.ADMIN:
        return {table: ALL for tables in TABLE_GROUPS.values() for table in tables}
    merged = _expand(BASE_OBJECT_PRIVILEGES)
    for permission in permissions:
        for table, privileges in _expand(PERMISSION_OBJECT_PRIVILEGES.get(permission, {})).items():
            merged.setdefault(table, set()).update(privileges)
    # Un privilegio de columna sobra si la tabla entera ya lo tiene.
    for target in [target for target in merged if "." in target]:
        table = target.split(".", 1)[0]
        merged[target] -= merged.get(table, set())
        if not merged[target]:
            del merged[target]
    return {table: frozenset(privileges) for table, privileges in merged.items() if privileges}

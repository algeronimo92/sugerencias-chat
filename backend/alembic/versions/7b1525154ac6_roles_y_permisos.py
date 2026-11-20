"""Roles y permisos en la base.

Revision ID: 7b1525154ac6
Revises: d2b7e4f91a63
Create Date: 2026-11-20

Hasta acá lo que podía hacer cada rol estaba repartido en el código:
``require_admin`` en cada ruta, comparaciones de ``user.role`` y la lista
cerrada de rutas del analista. Ahora cada ruta pide un permiso y el negocio
decide qué permisos tiene el vendedor y el analista (el admin tiene todos).

- ``roles``: los tres roles fijos. ``users.role`` pasa de CHECK a clave
  foránea con los mismos valores, así que el color viejo de un despliegue
  blue-green sigue escribiendo usuarios válidos.
- ``permissions``: el catálogo de ``app/modules/auth/permissions.py``. Se
  copia acá en vez de importarlo: una migración aplicada no puede cambiar
  cuando el código cambia.
- ``role_permissions``: la matriz, sembrada con lo que cada rol podía hacer
  hasta hoy. El vendedor recibe ``leads.view_all`` salvo que el negocio
  tuviera encendido ``sellers_see_only_assigned_leads``; el ajuste queda
  guardado para el color viejo y la app ya lo lee de la matriz.

Plano tenant: donde no está ``users`` (public) no hace nada.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "7b1525154ac6"
down_revision: Union[str, None] = "d2b7e4f91a63"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

ROLES = (
    ("admin", "Administrador", False),
    ("vendedor", "Vendedor", True),
    ("analista", "Analista", True),
)

ADMIN_ONLY = {"settings.manage", "users.manage"}

PERMISSIONS = (
    "dashboard.view", "dashboard.view_member", "dashboard.export", "dashboard.export_personal_data",
    "leads.view", "leads.view_all", "leads.edit", "leads.assign", "leads.merge", "leads.delete",
    "conversations.view", "conversations.send", "calls.handle", "team.supervise",
    "tasks.use",
    "appointments.view", "appointments.edit", "appointments.manage", "appointments.configure",
    "contacts.view", "contacts.edit", "contacts.delete", "contacts.import",
    "automations.run", "automations.manage",
    "templates.use", "templates.manage", "catalogs.manage", "media_library.manage",
    "ai.configure", "issue_reports.manage",
    "settings.manage", "users.manage",
)

SELLER_DEFAULTS = (
    "leads.view", "leads.edit",
    "conversations.view", "conversations.send", "calls.handle",
    "tasks.use",
    "appointments.view", "appointments.edit",
    "contacts.view", "contacts.edit",
    "automations.run",
    "templates.use",
)
ANALYST_DEFAULTS = ("dashboard.view", "dashboard.export")


def _table_exists(bind, table: str) -> bool:
    """En el schema activo (el del negocio que se está migrando)."""
    return bind.execute(sa.text(
        "SELECT 1 FROM information_schema.tables "
        "WHERE table_schema = current_schema() AND table_name = :table"
    ), {"table": table}).first() is not None


def _sellers_scoped(bind) -> bool:
    if not _table_exists(bind, "app_settings"):
        return False
    value = bind.execute(sa.text(
        "SELECT value FROM app_settings WHERE key = 'sellers_see_only_assigned_leads'"
    )).scalar_one_or_none()
    return (value or "").strip().lower() == "true"


def upgrade() -> None:
    bind = op.get_bind()
    if not _table_exists(bind, "users") or _table_exists(bind, "roles"):
        return

    roles = op.create_table(
        "roles",
        sa.Column("key", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("editable", sa.Boolean(), nullable=False),
        sa.PrimaryKeyConstraint("key"),
    )
    permissions = op.create_table(
        "permissions",
        sa.Column("key", sa.Text(), nullable=False),
        sa.Column("admin_only", sa.Boolean(), nullable=False),
        sa.PrimaryKeyConstraint("key"),
    )
    role_permissions = op.create_table(
        "role_permissions",
        sa.Column("role", sa.Text(), nullable=False),
        sa.Column("permission", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(["role"], ["roles.key"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["permission"], ["permissions.key"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("role", "permission"),
    )

    op.bulk_insert(roles, [{"key": key, "name": name, "editable": editable} for key, name, editable in ROLES])
    op.bulk_insert(permissions, [{"key": key, "admin_only": key in ADMIN_ONLY} for key in PERMISSIONS])
    seller = list(SELLER_DEFAULTS)
    if not _sellers_scoped(bind):
        seller.append("leads.view_all")
    op.bulk_insert(role_permissions, [
        *({"role": "vendedor", "permission": key} for key in seller),
        *({"role": "analista", "permission": key} for key in ANALYST_DEFAULTS),
    ])

    op.drop_constraint("users_role_check", "users", type_="check")
    op.create_foreign_key("users_role_fkey", "users", "roles", ["role"], ["key"])


def downgrade() -> None:
    bind = op.get_bind()
    if not _table_exists(bind, "roles"):
        return
    op.drop_constraint("users_role_fkey", "users", type_="foreignkey")
    op.create_check_constraint("users_role_check", "users", "role IN ('admin', 'vendedor', 'analista')")
    op.drop_table("role_permissions")
    op.drop_table("permissions")
    op.drop_table("roles")

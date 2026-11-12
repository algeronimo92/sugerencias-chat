"""`public` sin tablas de negocio, como en producción.

Revision ID: e5c1a8f37b42
Revises: a7e3c5d91b20

La cadena de migraciones nació con un solo negocio en `public`. Desde el paso
a multi-tenant cada negocio vive en su propio schema, pero una base armada
desde cero sigue creando en `public` una copia vacía de cada tabla de negocio.
Producción no las tiene: `scripts/move_public_to_tenant.py` las movió al
schema de DermicaPro. Esa diferencia escondió que la migración a7e3c5d91b20
no contemplaba un `public` sin `users`, y el deploy de producción falló.

Esta migración borra esas copias de `public`, solo cuando es seguro:

- corre en `public`, no en el schema de un negocio;
- ya hay al menos un negocio con su schema creado (sin ninguno, `public`
  todavía es el único lugar donde vive el negocio, como en la base de CI);
- `users`, `leads` y `wsp_messages` de `public` están vacías: si alguna
  tiene filas, alguien opera el negocio ahí y no se toca nada.

En producción no hace nada: esas tablas ya no están.

``downgrade`` no las vuelve a crear: eran copias vacías que nada usa.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "e5c1a8f37b42"
down_revision: Union[str, None] = "a7e3c5d91b20"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# El plano de control y las tablas que existen en los dos lados, tal como
# estaban al escribir esta migración (scripts/move_public_to_tenant.py:
# CONTROL_PLANE_TABLES | SHARED_TABLES). Una migración no lee los modelos de
# hoy: tiene que hacer lo mismo cuando se corra dentro de un año.
KEEP_IN_PUBLIC = frozenset({
    "alembic_version",
    "auth_login_throttles",
    "knowledge_templates",
    "n8n_chat_histories",
    "organization_branding",
    "organization_domains",
    "organizations",
    "platform_sessions",
    "platform_settings",
    "platform_users",
    "tenant_schema_versions",
    "webhook_inbox",
    "whatsapp_connections",
})

# Solo tienen filas si alguien operó el negocio en ese schema (mismo criterio
# que move_public_to_tenant.ACTIVITY_TABLES).
ACTIVITY_TABLES = ("users", "leads", "wsp_messages")


def _public_tables(bind) -> list[str]:
    return list(bind.execute(sa.text(
        "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"
    )).scalars())


def _has_tenant_schema(bind) -> bool:
    if "organizations" not in _public_tables(bind):
        return False
    return bind.execute(sa.text(
        "SELECT 1 FROM public.organizations o "
        "JOIN pg_namespace n ON n.nspname = o.schema_name "
        "WHERE o.schema_name <> 'public' LIMIT 1"
    )).first() is not None


def _activity_in_public(bind, tables: list[str]) -> bool:
    for table in ACTIVITY_TABLES:
        if table in tables and bind.execute(sa.text(f'SELECT 1 FROM public."{table}" LIMIT 1')).first():
            return True
    return False


def upgrade() -> None:
    bind = op.get_bind()
    if bind.execute(sa.text("SELECT current_schema()")).scalar_one() != "public":
        return
    tables = _public_tables(bind)
    business = [name for name in tables if name not in KEEP_IN_PUBLIC]
    if not business or not _has_tenant_schema(bind) or _activity_in_public(bind, tables):
        return
    # CASCADE solo alcanza FK entre estas mismas tablas: ningún schema de
    # negocio ni el plano de control apunta a las copias de `public`.
    op.execute("DROP TABLE " + ", ".join(f'public."{name}"' for name in business) + " CASCADE")


def downgrade() -> None:
    pass

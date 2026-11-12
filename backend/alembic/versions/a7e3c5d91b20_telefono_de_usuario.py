"""Teléfono de WhatsApp de cada usuario del equipo.

Revision ID: a7e3c5d91b20
Revises: c4d8e2f61a93

Lo usa el aviso de cita al equipo: el responsable y los admins reciben la
venta nueva por WhatsApp. Nulo es "sin teléfono": ese usuario solo se entera
en la app. Se guarda en E.164 sin "+", como el ``wa_id`` de Meta.

Plano tenant: corre en cada schema, también en `public`, donde no hay
`users`. La primera versión no lo tenía en cuenta y el deploy de producción
falló con 'relation "users" does not exist' antes de migrar ningún negocio.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "a7e3c5d91b20"
down_revision: Union[str, None] = "c4d8e2f61a93"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(bind, table: str) -> bool:
    """En el schema activo (el del negocio que se está migrando)."""
    return bind.execute(sa.text(
        "SELECT 1 FROM information_schema.tables "
        "WHERE table_schema = current_schema() AND table_name = :table"
    ), {"table": table}).first() is not None


def _column_exists(bind, table: str, column: str) -> bool:
    return bind.execute(sa.text(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_schema = current_schema() AND table_name = :table AND column_name = :column"
    ), {"table": table, "column": column}).first() is not None


def upgrade() -> None:
    bind = op.get_bind()
    # Un entorno donde la versión anterior sí corrió ya tiene la columna.
    if not _table_exists(bind, "users") or _column_exists(bind, "users", "phone"):
        return
    op.add_column("users", sa.Column("phone", sa.Text(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    if not _table_exists(bind, "users") or not _column_exists(bind, "users", "phone"):
        return
    op.drop_column("users", "phone")

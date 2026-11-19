"""Usuarios que atienden llamadas de WhatsApp.

Revision ID: c41d9a7e5b20
Revises: a3d7e1c94b52
Create Date: 2026-11-19

``users.can_handle_calls`` dice a quién le suenan las llamadas del número del
negocio y quién puede llamar a un cliente. Lo decide el admin persona por
persona (docs/analisis/17-plan-llamadas-whatsapp.md, §4.7): nadie lo tiene
hasta que se lo den.

Con ``server_default``: durante el blue-green el color viejo sigue creando
usuarios sin conocer la columna.

Plano tenant: corre en cada schema; donde no está la tabla no hace nada.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c41d9a7e5b20"
down_revision: Union[str, None] = "a3d7e1c94b52"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    if not _table_exists(op.get_bind(), "users"):
        return
    op.add_column(
        "users",
        sa.Column("can_handle_calls", sa.Boolean(), server_default="false", nullable=False),
    )


def downgrade() -> None:
    if not _table_exists(op.get_bind(), "users"):
        return
    op.drop_column("users", "can_handle_calls")


def _table_exists(bind, table: str) -> bool:
    """En el schema activo (el del negocio que se está migrando)."""
    return bind.execute(sa.text(
        "SELECT 1 FROM information_schema.tables "
        "WHERE table_schema = current_schema() AND table_name = :table"
    ), {"table": table}).first() is not None

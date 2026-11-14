"""Citas desestimadas.

Revision ID: b8e3f1a6c2d4
Revises: c6f2a8d4e173

Una cita registrada en modo real que no es de un cliente (una prueba del
flujo completo, por ejemplo para el permiso de eventos de Meta) se marca como
desestimada en vez de borrarse: deja de contar en el panel y en las
exportaciones, y se puede restaurar.

Plano tenant: corre en cada schema; donde no está la tabla no hace nada.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "b8e3f1a6c2d4"
down_revision: Union[str, None] = "c6f2a8d4e173"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


TABLE = "appointments"


def upgrade() -> None:
    bind = op.get_bind()
    # Plano tenant: migrate.py también corre la cadena sobre public, que no
    # tiene ``appointments`` (ver test_public_plane_migrations_postgres).
    if not _table_exists(bind) or _column_exists(bind, "dismissed_at"):
        return
    op.add_column(TABLE, sa.Column("dismissed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(TABLE, sa.Column("dismissed_by_user_id", sa.Integer(), nullable=True))
    op.add_column(TABLE, sa.Column("dismissed_reason", sa.Text(), nullable=True))
    op.create_foreign_key(
        "appointments_dismissed_by_user_id_fkey", TABLE, "users",
        ["dismissed_by_user_id"], ["id"], ondelete="SET NULL",
    )


def _table_exists(bind) -> bool:
    """En el schema activo (el del negocio que se está migrando)."""
    return bind.execute(sa.text(
        "SELECT 1 FROM information_schema.tables "
        "WHERE table_schema = current_schema() AND table_name = :table"
    ), {"table": TABLE}).first() is not None


def _column_exists(bind, column: str) -> bool:
    return bind.execute(sa.text(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_schema = current_schema() AND table_name = :table AND column_name = :column"
    ), {"table": TABLE, "column": column}).first() is not None


def downgrade() -> None:
    if not _table_exists(op.get_bind()):
        return
    op.execute(f"ALTER TABLE {TABLE} DROP CONSTRAINT IF EXISTS appointments_dismissed_by_user_id_fkey")
    for column in ("dismissed_reason", "dismissed_by_user_id", "dismissed_at"):
        op.execute(f"ALTER TABLE {TABLE} DROP COLUMN IF EXISTS {column}")

"""Etapa a la que pasa un lead al agendarle una cita.

Revision ID: c7d4a1e9b263
Revises: b5e1d7c3a920
Create Date: 2026-11-05

Agendar desde el lead mueve el lead a la etapa que el negocio eligió. Las
etapas son de cada negocio y ninguna significa "cita" para el código, así que
la elección es una marca en la etapa. El índice parcial garantiza que haya a
lo sumo una marcada; ninguna marcada significa que agendar no mueve el lead.

Plano tenant: corre en cada schema, como la tabla.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c7d4a1e9b263"
down_revision: Union[str, None] = "b5e1d7c3a920"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


TABLE = "lead_stages"
COLUMN = "on_appointment"
INDEX = "uq_lead_stages_on_appointment"


def upgrade() -> None:
    bind = op.get_bind()
    # Plano tenant. migrate.py también corre la cadena sobre public, donde
    # puede no existir ``lead_stages`` (ver b5e1d7c3a920): ahí no hay nada que
    # agregar.
    if not _table_exists(bind, TABLE):
        return
    if not _column_exists(bind, TABLE, COLUMN):
        op.add_column(
            TABLE,
            sa.Column(COLUMN, sa.Boolean(), server_default=sa.text("false"), nullable=False),
        )
    op.create_index(
        INDEX,
        TABLE,
        [COLUMN],
        unique=True,
        postgresql_where=sa.text(COLUMN),
        if_not_exists=True,
    )


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


def downgrade() -> None:
    op.execute(f"DROP INDEX IF EXISTS {INDEX}")
    op.execute(f"ALTER TABLE IF EXISTS {TABLE} DROP COLUMN IF EXISTS {COLUMN}")

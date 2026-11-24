"""Marca de «descartada» en las ejecuciones que piden atención.

«Por atender» junta los fallos recientes y lo olvidado en pausa. Sin una
forma de decir «ya lo vi, no hay nada que hacer», esa lista no se vaciaba
nunca y la pantalla no podía abrir ahí cuando hay pendientes.

Columna nueva, opcional y sin valor por defecto: no reescribe la tabla.

Plano tenant: corre en cada schema. ``migrate.py`` también recorre public,
donde ``automation_executions`` no existe: ahí no hay nada que cambiar.

Revision ID: c4e8a1b72d95
Revises: b7d2f4a91c36
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "c4e8a1b72d95"
down_revision: Union[str, None] = "b7d2f4a91c36"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


TABLE = "automation_executions"
COLUMN = "attention_dismissed_at"


def _table_exists(bind, table: str) -> bool:
    """En el schema activo (el del negocio que se está migrando)."""
    return bind.execute(sa.text(
        "SELECT 1 FROM information_schema.tables "
        "WHERE table_schema = current_schema() AND table_name = :table"
    ), {"table": table}).first() is not None


def upgrade() -> None:
    if not _table_exists(op.get_bind(), TABLE):
        return
    op.add_column(TABLE, sa.Column(COLUMN, sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    if not _table_exists(op.get_bind(), TABLE):
        return
    op.drop_column(TABLE, COLUMN)

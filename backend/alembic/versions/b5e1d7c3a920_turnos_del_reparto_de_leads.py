"""Turnos del reparto automático de leads.

Revision ID: b5e1d7c3a920
Revises: a8e3c5f17b42
Create Date: 2026-11-04

El reparto por turnos elegía al vendedor cuyo último lead era el más viejo
según ``leads.created_at``. Esa hora se fija antes de esperar el lock del
reparto, así que con varias altas a la vez el orden de creación no coincidía
con el de asignación y un vendedor recibía de más. Desde acá cada vendedor
tiene su propia marca de "último lead recibido", escrita bajo el lock.

La marca inicial sale de la historia (su lead asignado más reciente) para
que el turno siga donde estaba. Una base nueva ya trae la tabla (la línea
base crea el esquema desde los modelos): se crea solo si falta.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b5e1d7c3a920"
down_revision: Union[str, None] = "a8e3c5f17b42"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "lead_assignment_turns"


def upgrade() -> None:
    bind = op.get_bind()
    # Plano tenant. migrate.py también corre la cadena sobre public, que en
    # producción conserva tablas viejas del negocio pero ya no ``users`` ni
    # ``leads``: ahí no hay turnos que llevar. Sin esta guarda el deploy del
    # 2026-11-05 falló con 'relation "users" does not exist'.
    if not (_table_exists(bind, "users") and _table_exists(bind, "leads")):
        return
    if not _table_exists(bind, TABLE):
        op.create_table(
            TABLE,
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("last_assigned_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("user_id"),
        )
    bind.execute(sa.text(
        f"INSERT INTO {TABLE} (user_id, last_assigned_at) "
        "SELECT l.vendedor_id, max(l.created_at) FROM leads l "
        "JOIN users u ON u.id = l.vendedor_id "
        "WHERE l.created_at IS NOT NULL "
        "GROUP BY l.vendedor_id "
        "ON CONFLICT (user_id) DO NOTHING"
    ))


def _table_exists(bind, table: str) -> bool:
    """En el schema activo (el del negocio que se está migrando)."""
    return bind.execute(sa.text(
        "SELECT 1 FROM information_schema.tables "
        "WHERE table_schema = current_schema() AND table_name = :table"
    ), {"table": table}).first() is not None


def downgrade() -> None:
    op.execute(f"DROP TABLE IF EXISTS {TABLE}")

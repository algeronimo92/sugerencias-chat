"""Se borran las columnas que solo usaban las reglas simples.

``actions`` (la lista de acciones), ``builder_mode`` (simple o visual) y
``delay_minutes`` (la demora antes de la primera acción) de
``automation_rules``. Desde la revisión anterior nadie las lee ni las
escribe, y esa versión del backend ya está desplegada: por eso el borrado va
en un despliegue aparte y no junto con ella.

``conditions`` se queda: los flujos guardan ahí sus condiciones de entrada.

Plano tenant: corre en cada schema. ``migrate.py`` también recorre public,
donde la tabla no existe: ahí no hay nada que cambiar.

Revision ID: c8f2b6d04a17
Revises: a3d7e5c19f42
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "c8f2b6d04a17"
down_revision: Union[str, None] = "a3d7e5c19f42"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


TABLE = "automation_rules"
INDEX = "idx_automation_rules_builder_mode"


def _table_exists(bind, table: str) -> bool:
    """En el schema activo (el del negocio que se está migrando)."""
    return bind.execute(sa.text(
        "SELECT 1 FROM information_schema.tables "
        "WHERE table_schema = current_schema() AND table_name = :table"
    ), {"table": table}).first() is not None


def upgrade() -> None:
    if not _table_exists(op.get_bind(), TABLE):
        return
    op.execute(f"DROP INDEX IF EXISTS {INDEX}")
    for column in ("actions", "builder_mode", "delay_minutes"):
        op.execute(f"ALTER TABLE {TABLE} DROP COLUMN IF EXISTS {column}")


def downgrade() -> None:
    if not _table_exists(op.get_bind(), TABLE):
        return
    # Vuelven vacías: el contenido de las reglas simples no se recupera.
    op.add_column(TABLE, sa.Column("actions", postgresql.JSONB(), server_default="[]", nullable=False))
    op.add_column(TABLE, sa.Column("builder_mode", sa.Text(), server_default="visual", nullable=False))
    op.add_column(TABLE, sa.Column("delay_minutes", sa.Integer(), server_default="0", nullable=False))
    op.create_index(INDEX, TABLE, ["builder_mode", "is_active"])

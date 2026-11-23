"""Cuándo se envió a Meta cada cambio de una plantilla aprobada.

Meta admite un cambio cada 24 horas y diez cada 30 días por plantilla
aprobada. Sin estas fechas la app no podía avisar que el cupo estaba gastado:
el segundo intento del día fallaba recién en Meta.

Plano tenant: corre en cada schema. ``migrate.py`` también recorre public,
donde ``message_templates`` no existe: ahí no hay nada que cambiar.

Revision ID: a3c7e5d19b42
Revises: 7b1525154ac6
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "a3c7e5d19b42"
down_revision: Union[str, None] = "7b1525154ac6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


TABLE = "message_templates"
COLUMN = "official_edit_times"


def _table_exists(bind, table: str) -> bool:
    """En el schema activo (el del negocio que se está migrando)."""
    return bind.execute(sa.text(
        "SELECT 1 FROM information_schema.tables "
        "WHERE table_schema = current_schema() AND table_name = :table"
    ), {"table": table}).first() is not None


def upgrade() -> None:
    if not _table_exists(op.get_bind(), TABLE):
        return
    op.add_column(
        TABLE,
        sa.Column(COLUMN, postgresql.JSONB(astext_type=sa.Text()), server_default="[]", nullable=False),
    )


def downgrade() -> None:
    if not _table_exists(op.get_bind(), TABLE):
        return
    op.drop_column(TABLE, COLUMN)

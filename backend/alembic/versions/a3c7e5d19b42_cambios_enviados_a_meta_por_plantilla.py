"""Cuándo se envió a Meta cada cambio de una plantilla aprobada.

Meta admite un cambio cada 24 horas y diez cada 30 días por plantilla
aprobada. Sin estas fechas la app no podía avisar que el cupo estaba gastado:
el segundo intento del día fallaba recién en Meta.

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


def upgrade() -> None:
    op.add_column(
        "message_templates",
        sa.Column(
            "official_edit_times",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="[]",
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("message_templates", "official_edit_times")

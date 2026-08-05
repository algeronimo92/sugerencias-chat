"""estado de conversacion por lead

Revision ID: d1a5b8c3e742
Revises: c8e4a1f72b90
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "d1a5b8c3e742"
down_revision: Union[str, None] = "c8e4a1f72b90"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "leads",
        sa.Column("conversacion_abierta", sa.Boolean(), server_default=sa.false(), nullable=False),
    )
    op.add_column("leads", sa.Column("conversacion_abierta_at", sa.DateTime(timezone=True)))
    op.add_column("leads", sa.Column("conversacion_cerrada_at", sa.DateTime(timezone=True)))
    op.add_column(
        "leads",
        sa.Column("conversacion_version", sa.Integer(), server_default="0", nullable=False),
    )
    op.create_check_constraint(
        "ck_leads_conversacion_version_nonnegative",
        "leads",
        "conversacion_version >= 0",
    )


def downgrade() -> None:
    op.drop_constraint("ck_leads_conversacion_version_nonnegative", "leads", type_="check")
    op.drop_column("leads", "conversacion_version")
    op.drop_column("leads", "conversacion_cerrada_at")
    op.drop_column("leads", "conversacion_abierta_at")
    op.drop_column("leads", "conversacion_abierta")

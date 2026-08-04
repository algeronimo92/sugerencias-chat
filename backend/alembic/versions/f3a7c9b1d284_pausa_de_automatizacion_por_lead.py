"""Agrega leads.automatizacion_pausada.

Revision ID: f3a7c9b1d284
Revises: 82a6e1d4c930
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "f3a7c9b1d284"
down_revision: Union[str, None] = "82a6e1d4c930"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "leads",
        sa.Column(
            "automatizacion_pausada",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    op.drop_column("leads", "automatizacion_pausada")

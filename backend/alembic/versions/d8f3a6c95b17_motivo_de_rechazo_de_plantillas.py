"""Motivo de rechazo de plantillas oficiales (rejected_reason de Meta).

Revision ID: d8f3a6c95b17
Revises: b7d4e19a3f52
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "d8f3a6c95b17"
down_revision: Union[str, None] = "b7d4e19a3f52"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "message_templates",
        sa.Column("official_rejected_reason", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("message_templates", "official_rejected_reason")

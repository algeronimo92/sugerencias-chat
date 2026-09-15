"""Clave de idempotencia para message_outbox.

Revision ID: c4e8a1d6f239
Revises: 6af703c8bc6c
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "c4e8a1d6f239"
down_revision: Union[str, None] = "6af703c8bc6c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("message_outbox", sa.Column("dedupe_key", sa.Text(), nullable=True))
    op.create_index(
        "uq_message_outbox_dedupe_key", "message_outbox", ["dedupe_key"], unique=True,
    )


def downgrade() -> None:
    op.drop_index("uq_message_outbox_dedupe_key", table_name="message_outbox")
    op.drop_column("message_outbox", "dedupe_key")

"""Suscripciones Web Push.

Revision ID: c1d9f4a63e02
Revises: b2e8f6d04c53
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "c1d9f4a63e02"
down_revision: Union[str, None] = "b2e8f6d04c53"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "push_subscriptions",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("endpoint", sa.Text(), nullable=False),
        sa.Column("p256dh", sa.Text(), nullable=False),
        sa.Column("auth", sa.Text(), nullable=False),
        sa.Column("user_agent", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("endpoint"),
    )
    op.create_index(
        "idx_push_subscriptions_user",
        "push_subscriptions",
        ["user_id"],
    )


def downgrade() -> None:
    op.drop_index("idx_push_subscriptions_user", table_name="push_subscriptions")
    op.drop_table("push_subscriptions")

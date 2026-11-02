"""Tokens de acceso y deduplicación de correo transaccional.

Revision ID: 7c1a9e4b2d60
Revises: d9e2a4c7f1b5

Ambas tablas pertenecen al plano tenant: Alembic las crea dentro de cada
schema de negocio (y en ``public`` para la instalación legacy single-tenant).
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "7c1a9e4b2d60"
down_revision: Union[str, None] = "d9e2a4c7f1b5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "auth_action_tokens",
        sa.Column("id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("purpose", sa.Text(), nullable=False),
        sa.Column("token_hash", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "purpose IN ('invitation', 'password_reset')",
            name="auth_action_tokens_purpose_check",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index(
        "idx_auth_action_tokens_user",
        "auth_action_tokens",
        ["user_id", "purpose", "used_at"],
    )
    op.create_index(
        "idx_auth_action_tokens_expires", "auth_action_tokens", ["expires_at"]
    )

    op.create_table(
        "email_notification_log",
        sa.Column("event_key", sa.Text(), nullable=False),
        sa.Column("event_type", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('sending', 'sent')",
            name="email_notification_log_status_check",
        ),
        sa.PrimaryKeyConstraint("event_key"),
    )
    op.create_index(
        "idx_email_notification_log_type",
        "email_notification_log",
        ["event_type", "sent_at"],
    )


def downgrade() -> None:
    op.drop_table("email_notification_log")
    op.drop_table("auth_action_tokens")

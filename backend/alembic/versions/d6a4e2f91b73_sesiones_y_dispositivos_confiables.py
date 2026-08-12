"""Agrega sesiones revocables y dispositivos con acceso por PIN.

Revision ID: d6a4e2f91b73
Revises: e5b3d7c94a12
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "d6a4e2f91b73"
down_revision: Union[str, None] = "e5b3d7c94a12"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "trusted_devices",
        sa.Column("id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("token_hash", sa.Text(), nullable=False),
        sa.Column("pin_hash", sa.Text(), nullable=True),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("failed_pin_attempts", sa.SmallInteger(), server_default="0", nullable=False),
        sa.Column("locked_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index("idx_trusted_devices_user", "trusted_devices", ["user_id", "revoked_at"])
    op.create_index("idx_trusted_devices_expires", "trusted_devices", ["expires_at"])

    op.create_table(
        "auth_sessions",
        sa.Column("id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("trusted_device_id", postgresql.UUID(as_uuid=False), nullable=True),
        sa.Column("token_hash", sa.Text(), nullable=False),
        sa.Column("previous_token_hash", sa.Text(), nullable=True),
        sa.Column("previous_token_valid_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("auth_method", sa.Text(), nullable=False),
        sa.Column("persistent", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("idle_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("absolute_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("rotated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("device_name", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(["trusted_device_id"], ["trusted_devices.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("previous_token_hash"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index("idx_auth_sessions_user", "auth_sessions", ["user_id", "revoked_at"])
    op.create_index("idx_auth_sessions_expires", "auth_sessions", ["idle_expires_at", "absolute_expires_at"])
    op.create_index("idx_auth_sessions_device", "auth_sessions", ["trusted_device_id"])


def downgrade() -> None:
    op.drop_table("auth_sessions")
    op.drop_table("trusted_devices")

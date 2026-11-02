"""Límite persistente de login y segundo factor TOTP para admins.

Revision ID: a6d2e9b41c73
Revises: e9a1c5d7b3f4
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a6d2e9b41c73"
down_revision: Union[str, None] = "e9a1c5d7b3f4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "auth_login_throttles",
        sa.Column("key_hash", sa.Text(), primary_key=True),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("window_started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("locked_until", sa.DateTime(timezone=True)),
    )
    op.create_index("idx_auth_login_throttles_window", "auth_login_throttles", ["window_started_at"])
    op.create_table(
        "admin_totp",
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("secret_ciphertext", sa.Text()),
        sa.Column("pending_ciphertext", sa.Text()),
        sa.Column("pending_expires_at", sa.DateTime(timezone=True)),
        sa.Column("enabled_at", sa.DateTime(timezone=True)),
        sa.Column("last_used_step", sa.BigInteger()),
    )
    op.create_table(
        "admin_totp_recovery_codes",
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("code_hash", sa.Text(), primary_key=True),
    )


def downgrade() -> None:
    op.drop_table("admin_totp_recovery_codes")
    op.drop_table("admin_totp")
    op.drop_index("idx_auth_login_throttles_window", table_name="auth_login_throttles")
    op.drop_table("auth_login_throttles")

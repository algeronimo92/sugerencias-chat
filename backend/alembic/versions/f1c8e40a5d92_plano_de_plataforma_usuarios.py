"""public.platform_users y public.platform_sessions: identidad del operador de
la plataforma, separada de los `users` de cada negocio. Ver
docs/multi-tenant-saas-plan.md sección 5.2.

Revision ID: f1c8e40a5d92
Revises: e4a91c73db85
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import context, op


revision: str = "f1c8e40a5d92"
down_revision: Union[str, None] = "e4a91c73db85"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Tablas de plataforma: se instalan una sola vez en public, nunca al
    # aprovisionar el schema de un tenant (mismo guard que d2b7c4e91a60).
    if context.config.attributes.get("tenant_schema"):
        return

    op.create_table(
        "platform_users",
        sa.Column(
            "id",
            sa.dialects.postgresql.UUID(as_uuid=False),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("email", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email", name="uq_platform_users_email"),
        schema="public",
    )
    op.create_table(
        "platform_sessions",
        sa.Column(
            "id",
            sa.dialects.postgresql.UUID(as_uuid=False),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("platform_user_id", sa.dialects.postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("token_hash", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "last_used_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["platform_user_id"],
            ["public.platform_users.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash", name="uq_platform_sessions_token_hash"),
        schema="public",
    )
    # El login busca por hash de token; la limpieza, por vencimiento.
    op.create_index(
        "idx_platform_sessions_user",
        "platform_sessions",
        ["platform_user_id"],
        schema="public",
    )


def downgrade() -> None:
    if context.config.attributes.get("tenant_schema"):
        return
    op.drop_index("idx_platform_sessions_user", table_name="platform_sessions", schema="public")
    op.drop_table("platform_sessions", schema="public")
    op.drop_table("platform_users", schema="public")

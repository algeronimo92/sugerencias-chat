"""Marca por negocio: nombre visible, color principal y logo.

Revision ID: c5d2e8f1a7b3
Revises: b3e7a1c9d2f4

Tabla del plano de control: la marca se lee antes del login, resolviendo el
negocio por el dominio, cuando todavía no hay schema abierto. Un negocio sin
fila usa la marca de la plataforma y el nombre de su organización.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import context, op
from sqlalchemy.dialects import postgresql


revision: str = "c5d2e8f1a7b3"
down_revision: Union[str, None] = "b3e7a1c9d2f4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Plano de control: se instala una sola vez en public, nunca al
    # aprovisionar el schema de un tenant (mismo guard que d2b7c4e91a60).
    if context.config.attributes.get("tenant_schema"):
        return
    op.create_table(
        "organization_branding",
        sa.Column("organization_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("display_name", sa.Text(), nullable=True),
        sa.Column("primary_color", sa.Text(), nullable=True),
        sa.Column("logo_png", sa.LargeBinary(), nullable=True),
        sa.Column("icon_png", sa.LargeBinary(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint(
            "primary_color IS NULL OR primary_color ~ '^#[0-9a-f]{6}$'",
            name="organization_branding_color_check",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"], ["public.organizations.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("organization_id"),
        schema="public",
    )


def downgrade() -> None:
    if context.config.attributes.get("tenant_schema"):
        return
    op.drop_table("organization_branding", schema="public")

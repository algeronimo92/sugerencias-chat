"""public.platform_settings: credenciales verdaderamente globales de la
plataforma (app de Meta compartida, cifrado, infraestructura), separadas de
`app_settings` que es por-negocio. Ver docs/multi-tenant-saas-plan.md sección 3.

Revision ID: c8fdf62268bc
Revises: d2b7c4e91a60
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import context, op


revision: str = "c8fdf62268bc"
down_revision: Union[str, None] = "d2b7c4e91a60"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Tabla de plataforma: se instala una sola vez en public, nunca al
    # aprovisionar el schema de un tenant nuevo (ver el mismo guard en
    # d2b7c4e91a60_control_plane_multitenant.py).
    if context.config.attributes.get("tenant_schema"):
        return
    op.create_table(
        "platform_settings",
        sa.Column("key", sa.Text(), nullable=False),
        sa.Column("encrypted_value", sa.Text(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("key"),
        schema="public",
    )


def downgrade() -> None:
    if context.config.attributes.get("tenant_schema"):
        return
    op.drop_table("platform_settings", schema="public")

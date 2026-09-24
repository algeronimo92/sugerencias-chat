"""Asistente IA administrado por la plataforma y alimentado por cada negocio.

Revision ID: b3e7a1c9d2f4
Revises: fb6d9c3e2a41

Plano de control: la plataforma decide si el negocio tiene el asistente y con
qué cuota mensual (``organizations.ai_enabled`` / ``ai_monthly_quota``). Las
columnas nacen en ``true``/``NULL`` para que los negocios existentes sigan
funcionando igual que antes.

Plano tenant: lo que el negocio carga para que el asistente lo conozca -- el
perfil (``ai_profile``), precio y descripción de sus servicios, el texto
completo de sus documentos de conocimiento y la descripción IA de los archivos
de su biblioteca que puede proponer como adjuntos.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import context, op


revision: str = "b3e7a1c9d2f4"
down_revision: Union[str, None] = "fb6d9c3e2a41"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _upgrade_control_plane() -> None:
    op.add_column(
        "organizations",
        sa.Column("ai_enabled", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        schema="public",
    )
    op.add_column(
        "organizations",
        sa.Column("ai_monthly_quota", sa.Integer(), nullable=True),
        schema="public",
    )
    op.create_check_constraint(
        "organizations_ai_monthly_quota_check",
        "organizations",
        "ai_monthly_quota IS NULL OR ai_monthly_quota >= 0",
        schema="public",
    )


def _upgrade_tenant_plane() -> None:
    op.create_table(
        "ai_profile",
        sa.Column("id", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column("business_name", sa.Text(), nullable=True),
        sa.Column("business_description", sa.Text(), nullable=True),
        sa.Column("location", sa.Text(), nullable=True),
        sa.Column("opening_hours", sa.Text(), nullable=True),
        sa.Column("currency", sa.Text(), nullable=True),
        sa.Column("tone", sa.Text(), nullable=True),
        sa.Column("always_rules", sa.Text(), nullable=True),
        sa.Column("never_rules", sa.Text(), nullable=True),
        sa.Column("updated_by", sa.Integer(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("id = 1", name="ai_profile_singleton_check"),
        sa.ForeignKeyConstraint(["updated_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.add_column("lead_services", sa.Column("description", sa.Text(), nullable=True))
    op.add_column("lead_services", sa.Column("price", sa.Numeric(12, 2), nullable=True))
    op.add_column("lead_services", sa.Column("price_notes", sa.Text(), nullable=True))
    op.create_check_constraint(
        "lead_services_price_check", "lead_services", "price IS NULL OR price >= 0"
    )
    op.add_column("knowledge_documents", sa.Column("content", sa.Text(), nullable=True))
    op.add_column("media_assets", sa.Column("ai_description", sa.Text(), nullable=True))


def upgrade() -> None:
    # Mismo reparto que d2b7c4e91a60: el plano de control se instala una sola
    # vez en public; el plano tenant corre en cada schema (y en public mientras
    # conviva el negocio legacy).
    if not context.config.attributes.get("tenant_schema"):
        _upgrade_control_plane()
    _upgrade_tenant_plane()


def downgrade() -> None:
    op.drop_column("media_assets", "ai_description")
    op.drop_column("knowledge_documents", "content")
    op.drop_constraint("lead_services_price_check", "lead_services", type_="check")
    op.drop_column("lead_services", "price_notes")
    op.drop_column("lead_services", "price")
    op.drop_column("lead_services", "description")
    op.drop_table("ai_profile")
    if context.config.attributes.get("tenant_schema"):
        return
    op.drop_constraint(
        "organizations_ai_monthly_quota_check", "organizations", schema="public", type_="check"
    )
    op.drop_column("organizations", "ai_monthly_quota", schema="public")
    op.drop_column("organizations", "ai_enabled", schema="public")

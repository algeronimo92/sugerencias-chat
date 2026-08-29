"""Tabla wsp_ad: clics a anuncios Click-to-WhatsApp y su venta asociada
(id_transaccion, valor_venta), recibidos por webhook/n8n. lead_id es
nullable porque al llegar el evento puede no existir todavia un lead con ese
telefono en whatsapp_identities.

Revision ID: f32cf61128a0
Revises: 4fbff1411836
Create Date: 2026-08-29 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = 'f32cf61128a0'
down_revision: Union[str, None] = '4fbff1411836'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "wsp_ad",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "lead_id",
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey("leads.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("telefono", sa.Text(), nullable=False),
        sa.Column("ctwaclid", sa.Text(), nullable=True),
        sa.Column("id_transaccion", sa.Text(), nullable=True),
        sa.Column("source_id", sa.BigInteger(), nullable=True),
        sa.Column("nombre", sa.Text(), nullable=True),
        sa.Column("apellido", sa.Text(), nullable=True),
        sa.Column("email", sa.Text(), nullable=True),
        sa.Column("ciudad", sa.Text(), nullable=True),
        sa.Column("provincia", sa.Text(), nullable=True),
        sa.Column("pais", sa.Text(), nullable=True),
        sa.Column("moneda", sa.Text(), nullable=True),
        sa.Column("valor_venta", sa.Numeric(12, 2), nullable=True),
        sa.Column("item_id", sa.Text(), nullable=True),
        sa.Column("item_nombre", sa.Text(), nullable=True),
        sa.Column("mensaje", sa.Text(), nullable=True),
        sa.Column("cta", sa.Text(), nullable=True),
        sa.Column("source_url", sa.Text(), nullable=True),
        sa.Column("thumbnail_url", sa.Text(), nullable=True),
        sa.Column("estado_transaccion", sa.Text(), nullable=True),
        sa.Column("plataforma", sa.Text(), nullable=True),
        sa.Column("procesado", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("fecha_interaccion", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("idx_wsp_ad_lead", "wsp_ad", ["lead_id"])
    op.create_index("idx_wsp_ad_telefono", "wsp_ad", ["telefono"])
    op.create_index("idx_wsp_ad_ctwaclid", "wsp_ad", ["ctwaclid"])


def downgrade() -> None:
    op.drop_index("idx_wsp_ad_ctwaclid", table_name="wsp_ad")
    op.drop_index("idx_wsp_ad_telefono", table_name="wsp_ad")
    op.drop_index("idx_wsp_ad_lead", table_name="wsp_ad")
    op.drop_table("wsp_ad")

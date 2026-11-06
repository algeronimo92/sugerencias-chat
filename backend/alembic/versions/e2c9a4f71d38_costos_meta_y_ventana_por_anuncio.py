"""Costos de WhatsApp informados por Meta y ventana gratis por anuncio.

Revision ID: e2c9a4f71d38
Revises: c7d4a1e9b263
Create Date: 2026-11-06

Desde el 2026-10-01 Meta cobra los mensajes de servicio pasados los 1.000
gratis del mes y las plantillas utility dentro de la ventana de 24 h.
``whatsapp_pricing_daily`` guarda la copia diaria de ``pricing_analytics`` de
la WABA, único lugar donde Meta informa montos.

``whatsapp_entry_point_windows`` guarda, por chat, el vencimiento de la
ventana gratis por anuncio (Free Entry Point, hasta 7 días desde el
2026-09-28) que Meta informa en el webhook de estado.

Plano tenant: corre en cada schema. ``migrate.py`` también recorre public,
donde puede no existir ``leads`` (ver c7d4a1e9b263): ahí no se crea nada.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "e2c9a4f71d38"
down_revision: Union[str, None] = "c7d4a1e9b263"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    if not _table_exists(bind, "leads"):
        return

    if not _table_exists(bind, "whatsapp_entry_point_windows"):
        op.create_table(
            "whatsapp_entry_point_windows",
            sa.Column("chat_id", postgresql.UUID(as_uuid=False), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("wa_message_id", sa.Text(), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.ForeignKeyConstraint(["chat_id"], ["leads.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("chat_id"),
        )

    if not _table_exists(bind, "whatsapp_pricing_daily"):
        op.create_table(
            "whatsapp_pricing_daily",
            sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
            sa.Column("day", sa.Date(), nullable=False),
            sa.Column("period_start", sa.DateTime(timezone=True), nullable=False),
            sa.Column("period_end", sa.DateTime(timezone=True), nullable=False),
            sa.Column("country", sa.Text(), server_default="", nullable=False),
            sa.Column("pricing_category", sa.Text(), nullable=False),
            sa.Column("pricing_type", sa.Text(), nullable=False),
            sa.Column("tier", sa.Text(), server_default="", nullable=False),
            sa.Column("volume", sa.Integer(), server_default="0", nullable=False),
            sa.Column("cost", sa.Numeric(14, 6), server_default="0", nullable=False),
            sa.Column("currency", sa.Text(), nullable=True),
            sa.Column("synced_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )
    op.create_index(
        "uq_whatsapp_pricing_daily_point",
        "whatsapp_pricing_daily",
        ["day", "country", "pricing_category", "pricing_type", "tier"],
        unique=True,
        if_not_exists=True,
    )


def _table_exists(bind, table: str) -> bool:
    """En el schema activo (el del negocio que se está migrando)."""
    return bind.execute(sa.text(
        "SELECT 1 FROM information_schema.tables "
        "WHERE table_schema = current_schema() AND table_name = :table"
    ), {"table": table}).first() is not None


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS whatsapp_pricing_daily")
    op.execute("DROP TABLE IF EXISTS whatsapp_entry_point_windows")

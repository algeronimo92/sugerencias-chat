"""Costos de WhatsApp por cuenta: la de los chats y la del número de avisos.

Revision ID: a3d7e1c94b52
Revises: b8e3f1a6c2d4
Create Date: 2026-11-18

El número de avisos de cita vinculado con coexistencia queda en su propia
WABA (Meta no deja elegir una existente), y Meta informa los montos por WABA.
``account`` dice de cuál vino cada punto: ``chats`` (la del CRM, todo lo que
había hasta ahora) o ``notices``. El índice único lo incluye para que un mismo
día y tarifa de las dos cuentas no choquen.

Plano tenant: corre en cada schema; donde no está la tabla no hace nada.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a3d7e1c94b52"
down_revision: Union[str, None] = "b8e3f1a6c2d4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    if not _table_exists(op.get_bind(), "whatsapp_pricing_daily"):
        return
    op.add_column(
        "whatsapp_pricing_daily",
        sa.Column("account", sa.Text(), server_default="chats", nullable=False),
    )
    op.drop_index("uq_whatsapp_pricing_daily_point", table_name="whatsapp_pricing_daily")
    op.create_index(
        "uq_whatsapp_pricing_daily_point",
        "whatsapp_pricing_daily",
        ["account", "day", "country", "pricing_category", "pricing_type", "tier"],
        unique=True,
    )


def downgrade() -> None:
    if not _table_exists(op.get_bind(), "whatsapp_pricing_daily"):
        return
    op.execute("DELETE FROM whatsapp_pricing_daily WHERE account <> 'chats'")
    op.drop_index("uq_whatsapp_pricing_daily_point", table_name="whatsapp_pricing_daily")
    op.create_index(
        "uq_whatsapp_pricing_daily_point",
        "whatsapp_pricing_daily",
        ["day", "country", "pricing_category", "pricing_type", "tier"],
        unique=True,
    )
    op.drop_column("whatsapp_pricing_daily", "account")


def _table_exists(bind, table: str) -> bool:
    """En el schema activo (el del negocio que se está migrando)."""
    return bind.execute(sa.text(
        "SELECT 1 FROM information_schema.tables "
        "WHERE table_schema = current_schema() AND table_name = :table"
    ), {"table": table}).first() is not None

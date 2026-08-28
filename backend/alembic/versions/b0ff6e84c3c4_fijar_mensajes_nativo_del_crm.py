"""Fijar mensajes, nativo del CRM.

WhatsApp no tiene ningun endpoint para fijar un mensaje del lado de quien
envia (ni Evolution API ni Baileys lo exponen), asi que esto no se puede
replicar hacia WhatsApp: vive solo en el CRM. Hasta 3 mensajes por chat,
igual que el limite real de WhatsApp (se aplica en db_service, no acá).

Revision ID: b0ff6e84c3c4
Revises: 6acf4e3b1c0a
Create Date: 2026-08-28 13:20:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'b0ff6e84c3c4'
down_revision: Union[str, None] = '6acf4e3b1c0a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("wsp_messages", sa.Column("pinned_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("wsp_messages", sa.Column("pinned_by_user_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_wsp_messages_pinned_by_user_id", "wsp_messages", "users",
        ["pinned_by_user_id"], ["id"], ondelete="SET NULL",
    )
    op.create_index(
        "idx_wsp_messages_pinned", "wsp_messages", ["chat_id", "pinned_at"],
        postgresql_where=sa.text("pinned_at IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("idx_wsp_messages_pinned", table_name="wsp_messages")
    op.drop_constraint("fk_wsp_messages_pinned_by_user_id", "wsp_messages", type_="foreignkey")
    op.drop_column("wsp_messages", "pinned_by_user_id")
    op.drop_column("wsp_messages", "pinned_at")

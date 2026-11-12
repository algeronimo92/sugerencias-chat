"""Proveedor y conexión usados por cada mensaje.

Revision ID: d5e9f3a72b14
Revises: c4d8e2f61a93
Create Date: 2026-11-12

Permite que Meta y Evolution estén activos a la vez: una respuesta conserva el
canal del hilo en vez de depender de un proveedor global.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "d5e9f3a72b14"
down_revision: Union[str, None] = "c4d8e2f61a93"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(bind, table: str) -> bool:
    return bind.execute(sa.text(
        "SELECT 1 FROM information_schema.tables "
        "WHERE table_schema = current_schema() AND table_name = :table"
    ), {"table": table}).first() is not None


def upgrade() -> None:
    if not _table_exists(op.get_bind(), "wsp_messages"):
        return
    op.add_column("wsp_messages", sa.Column("channel_provider", sa.Text(), nullable=True))
    op.add_column("wsp_messages", sa.Column("channel_connection", sa.Text(), nullable=True))
    op.create_index(
        "idx_wsp_messages_chat_channel",
        "wsp_messages",
        ["chat_id", "channel_provider", "sent_at"],
    )


def downgrade() -> None:
    if not _table_exists(op.get_bind(), "wsp_messages"):
        return
    op.drop_index("idx_wsp_messages_chat_channel", table_name="wsp_messages")
    op.drop_column("wsp_messages", "channel_connection")
    op.drop_column("wsp_messages", "channel_provider")

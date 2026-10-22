"""``wsp_messages.wa_message_id`` único en todos los schemas.

Revision ID: e9a1c5d7b3f4
Revises: d4b8e1f3a6c2

``db/models.py`` declara el índice parcial como UNIQUE y la ingesta de Meta
depende de eso para no duplicar un mensaje cuando Meta reintenta la entrega.
En ``public`` lo era, pero los schemas de negocio lo tenían como índice común:
un reintento podía insertar el mismo mensaje dos veces.

Los duplicados que ya existan se copian a ``archived_wsp_messages`` y se
borran, conservando la fila más antigua de cada ``wa_message_id``.
"""

from typing import Sequence, Union

from alembic import op


revision: str = "e9a1c5d7b3f4"
down_revision: Union[str, None] = "d4b8e1f3a6c2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        WITH duplicated AS (
            SELECT id FROM (
                SELECT id, row_number() OVER (PARTITION BY wa_message_id ORDER BY id) AS position
                FROM wsp_messages
                WHERE wa_message_id IS NOT NULL
            ) AS ranked
            WHERE position > 1
        )
        INSERT INTO archived_wsp_messages (message_id, chat_id, reason, snapshot)
        SELECT m.id, m.chat_id, 'wa_message_id_duplicado', to_jsonb(m)
        FROM wsp_messages AS m
        JOIN duplicated USING (id)
        """
    )
    op.execute(
        """
        DELETE FROM wsp_messages
        WHERE id IN (
            SELECT message_id FROM archived_wsp_messages WHERE reason = 'wa_message_id_duplicado'
        )
        """
    )
    op.execute("DROP INDEX IF EXISTS idx_wsp_messages_wa_message_id")
    op.execute(
        "CREATE UNIQUE INDEX idx_wsp_messages_wa_message_id ON wsp_messages (wa_message_id) "
        "WHERE wa_message_id IS NOT NULL"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_wsp_messages_wa_message_id")
    op.execute(
        "CREATE INDEX idx_wsp_messages_wa_message_id ON wsp_messages (wa_message_id) "
        "WHERE wa_message_id IS NOT NULL"
    )

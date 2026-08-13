"""Soporte normalizado para orderMessage de WhatsApp Business.

Revision ID: a9c4e7f21b63
Revises: f8a4d1c72e90
"""

from typing import Sequence, Union

from alembic import op


revision: str = "a9c4e7f21b63"
down_revision: Union[str, None] = "f8a4d1c72e90"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


MESSAGE_TYPES = (
    "text", "image", "video", "ptv", "audio", "document", "location",
    "sticker", "contact", "poll", "reaction", "interactive", "template",
    "order", "unsupported",
)


def _replace_constraint(types: tuple[str, ...]) -> None:
    allowed = ", ".join(f"'{message_type}'" for message_type in types)
    op.execute(
        "ALTER TABLE wsp_messages "
        "DROP CONSTRAINT IF EXISTS wsp_messages_message_type_check"
    )
    op.execute(
        "ALTER TABLE wsp_messages "
        "ADD CONSTRAINT wsp_messages_message_type_check "
        f"CHECK (message_type IS NULL OR message_type IN ({allowed}))"
    )


def upgrade() -> None:
    _replace_constraint(MESSAGE_TYPES)
    # Recupera el primer evento que los flujos anteriores sí alcanzaron a
    # guardar. Los estados que la deduplicación descartó no existen en DB y no
    # pueden reconstruirse aquí; volverán a aparecer al sincronizar historial.
    op.execute(
        """
        UPDATE wsp_messages
        SET message_type = 'order',
            content = COALESCE(
                NULLIF(content, ''),
                NULLIF(payload->>'message', ''),
                NULLIF(payload->>'title', ''),
                'Pedido de WhatsApp'
            )
        WHERE message_type = 'unsupported'
          AND payload->>'original_type' = 'orderMessage'
        """
    )


def downgrade() -> None:
    op.execute(
        """
        UPDATE wsp_messages
        SET message_type = 'unsupported',
            payload = COALESCE(payload, '{}'::jsonb)
                || '{"original_type":"orderMessage"}'::jsonb
        WHERE message_type = 'order'
        """
    )
    _replace_constraint(tuple(t for t in MESSAGE_TYPES if t != "order"))

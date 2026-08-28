"""Soporte para fijar/desfijar mensajes (pinInChatMessage) y backfill de
liveLocationMessage/lottieStickerMessage, que hasta ahora caían en
`unsupported` porque n8n no los ruteaba.

Revision ID: 6acf4e3b1c0a
Revises: e5c3a91f7b2d
Create Date: 2026-08-28 10:51:29.751435
"""

from typing import Sequence, Union

from alembic import op


revision: str = '6acf4e3b1c0a'
down_revision: Union[str, None] = 'e5c3a91f7b2d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


MESSAGE_TYPES = (
    "text", "image", "video", "ptv", "audio", "document", "location",
    "sticker", "contact", "poll", "reaction", "pin", "interactive", "template",
    "order", "product", "payment", "view_once", "unsupported",
)


def _replace_constraint(types: tuple[str, ...]) -> None:
    allowed = ", ".join(f"'{message_type}'" for message_type in types)
    op.execute("ALTER TABLE wsp_messages DROP CONSTRAINT IF EXISTS wsp_messages_message_type_check")
    op.execute(
        "ALTER TABLE wsp_messages ADD CONSTRAINT wsp_messages_message_type_check "
        f"CHECK (message_type IS NULL OR message_type IN ({allowed}))"
    )


def upgrade() -> None:
    _replace_constraint(MESSAGE_TYPES)
    # `liveLocationMessage` y `lottieStickerMessage` ya se leían como
    # `location`/`sticker` respectivamente antes de esta migración (comparten
    # campos con sus variantes estáticas), solo faltaba n8n rutearlos: las filas
    # viejas quedaron con `message_type='unsupported'`. `pinInChatMessage` es
    # un tipo nuevo. Ninguno de los tres guardó datos propios (coordenadas,
    # mensaje objetivo) en `payload` porque el nodo `unsupported content` solo
    # conserva `original_type` — igual que pasó con `view_once` en
    # c4f8a2d91e60, no se puede reconstruir esa parte retroactivamente.
    op.execute(
        "UPDATE wsp_messages SET message_type = 'location' "
        "WHERE message_type = 'unsupported' "
        "AND payload->>'original_type' = 'liveLocationMessage'"
    )
    op.execute(
        "UPDATE wsp_messages SET message_type = 'sticker' "
        "WHERE message_type = 'unsupported' "
        "AND payload->>'original_type' = 'lottieStickerMessage'"
    )
    op.execute(
        "UPDATE wsp_messages SET message_type = 'pin' "
        "WHERE message_type = 'unsupported' "
        "AND payload->>'original_type' = 'pinInChatMessage'"
    )


def downgrade() -> None:
    op.execute(
        "UPDATE wsp_messages SET message_type = 'unsupported' "
        "WHERE message_type = 'location' AND payload->>'original_type' = 'liveLocationMessage'"
    )
    op.execute(
        "UPDATE wsp_messages SET message_type = 'unsupported' "
        "WHERE message_type = 'sticker' AND payload->>'original_type' = 'lottieStickerMessage'"
    )
    op.execute(
        "UPDATE wsp_messages SET message_type = 'unsupported' "
        "WHERE message_type = 'pin' AND payload->>'original_type' = 'pinInChatMessage'"
    )
    _replace_constraint(tuple(t for t in MESSAGE_TYPES if t != "pin"))

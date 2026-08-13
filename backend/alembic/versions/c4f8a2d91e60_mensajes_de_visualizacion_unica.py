"""Mensajes de visualización única de WhatsApp.

Revision ID: c4f8a2d91e60
Revises: e9d3b7c21f48
"""

from typing import Sequence, Union

from alembic import op


revision: str = "c4f8a2d91e60"
down_revision: Union[str, None] = "e9d3b7c21f48"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


MESSAGE_TYPES = (
    "text", "image", "video", "ptv", "audio", "document", "location",
    "sticker", "contact", "poll", "reaction", "interactive", "template",
    "order", "product", "payment", "view_once", "unsupported",
)

VIEW_ONCE_TYPES = (
    "viewOnceMessage", "viewOnceMessageV2", "viewOnceMessageV2Extension",
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
    wrapped = ", ".join(f"'{message_type}'" for message_type in VIEW_ONCE_TYPES)
    op.execute(
        "UPDATE wsp_messages SET message_type = 'view_once' "
        "WHERE message_type = 'unsupported' "
        f"AND payload->>'original_type' IN ({wrapped})"
    )


def downgrade() -> None:
    op.execute(
        "UPDATE wsp_messages SET message_type = 'unsupported' "
        "WHERE message_type = 'view_once'"
    )
    _replace_constraint(tuple(t for t in MESSAGE_TYPES if t != "view_once"))

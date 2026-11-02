"""Tipo propio para respuestas de boton de Meta.

Revision ID: b4c7d9e2f6a1
Revises: e1f4a7c9d2b6
"""

from typing import Sequence, Union

from alembic import op


revision: str = "b4c7d9e2f6a1"
down_revision: Union[str, None] = "e1f4a7c9d2b6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


MESSAGE_TYPES = (
    "text", "image", "video", "ptv", "audio", "document", "location",
    "sticker", "contact", "poll", "reaction", "pin", "interactive",
    "button", "template", "order", "product", "payment", "view_once",
    "unsupported",
)


def _replace_constraint(types: tuple[str, ...]) -> None:
    allowed = ", ".join(f"'{message_type}'" for message_type in types)
    op.execute(
        "ALTER TABLE wsp_messages "
        "DROP CONSTRAINT IF EXISTS wsp_messages_message_type_check"
    )
    op.execute(
        "ALTER TABLE wsp_messages ADD CONSTRAINT wsp_messages_message_type_check "
        f"CHECK (message_type IS NULL OR message_type IN ({allowed}))"
    )


def upgrade() -> None:
    _replace_constraint(MESSAGE_TYPES)
    op.execute(
        "UPDATE wsp_messages SET message_type = 'button' "
        "WHERE message_type = 'unsupported' "
        "AND payload #>> '{message,type}' = 'button'"
    )


def downgrade() -> None:
    op.execute(
        "UPDATE wsp_messages SET message_type = 'unsupported' "
        "WHERE message_type = 'button'"
    )
    _replace_constraint(tuple(t for t in MESSAGE_TYPES if t != "button"))

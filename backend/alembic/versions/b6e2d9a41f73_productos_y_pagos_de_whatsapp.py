"""Tipos de producto y pago de WhatsApp Business.

Revision ID: b6e2d9a41f73
Revises: a9c4e7f21b63
"""

from typing import Sequence, Union

from alembic import op


revision: str = "b6e2d9a41f73"
down_revision: Union[str, None] = "a9c4e7f21b63"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


MESSAGE_TYPES = (
    "text", "image", "video", "ptv", "audio", "document", "location",
    "sticker", "contact", "poll", "reaction", "interactive", "template",
    "order", "product", "payment", "unsupported",
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
    op.execute(
        """
        UPDATE wsp_messages
        SET message_type = CASE
                WHEN payload->>'original_type' = 'productMessage' THEN 'product'
                WHEN payload->>'original_type' IN (
                    'invoiceMessage', 'requestPaymentMessage', 'sendPaymentMessage',
                    'paymentInviteMessage', 'cancelPaymentRequestMessage',
                    'declinePaymentRequestMessage'
                ) THEN 'payment'
                ELSE message_type
            END
        WHERE message_type = 'unsupported'
        """
    )


def downgrade() -> None:
    op.execute(
        "UPDATE wsp_messages SET message_type = 'unsupported' "
        "WHERE message_type IN ('product', 'payment')"
    )
    _replace_constraint(tuple(t for t in MESSAGE_TYPES if t not in {"product", "payment"}))

"""Consumer contract: only the operations used outside this capability."""

from app.modules.conversations.latest_message_queries import (
    latest_customer_message,
    latest_message,
    latest_outbound_media_wa_id,
)

__all__ = ['latest_customer_message', 'latest_message', 'latest_outbound_media_wa_id']

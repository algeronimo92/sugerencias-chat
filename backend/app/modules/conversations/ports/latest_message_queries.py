"""Consumer contract: only the operations used outside this capability."""

from app.modules.conversations.latest_message_queries import (
    latest_customer_message,
)

__all__ = ['latest_customer_message']

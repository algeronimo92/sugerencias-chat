"""Consumer contract: only the operations used outside this capability."""

from app.modules.conversations.message_history import (
    fetch_latest_customer_message_target,
)

__all__ = ['fetch_latest_customer_message_target']

"""Consumer contract: only the operations used outside this capability."""

from app.modules.conversations.read_state import (
    fetch_total_unread_chat_count,
    record_lead_touch,
)

__all__ = ['fetch_total_unread_chat_count', 'record_lead_touch']

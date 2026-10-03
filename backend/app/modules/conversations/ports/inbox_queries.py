"""Consumer contract: only the operations used outside this capability."""

from app.modules.conversations.inbox_queries import (
    fetch_total_unread_chat_count,
)

__all__ = ['fetch_total_unread_chat_count']

"""Consumer contract: only the operations used outside this capability."""

from app.modules.conversations.message_queries import (
    chat_id_for_wa_message,
    fetch_last_wa_message_id,
    fetch_message_by_wa_id,
)

__all__ = ['chat_id_for_wa_message', 'fetch_last_wa_message_id', 'fetch_message_by_wa_id']

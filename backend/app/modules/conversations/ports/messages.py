"""Consumer contract: only the operations used outside this capability."""

from app.modules.conversations.messages import (
    fetch_last_wa_message_id,
    fetch_message_by_wa_id,
)

__all__ = ['fetch_last_wa_message_id', 'fetch_message_by_wa_id']

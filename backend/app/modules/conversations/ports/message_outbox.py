"""Consumer contract: only the operations used outside this capability."""

from app.modules.conversations.message_outbox import (
    enqueue_messages,
)

__all__ = ['enqueue_messages']

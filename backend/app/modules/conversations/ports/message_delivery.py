"""Consumer contract: only the operations used outside this capability."""

from app.modules.conversations.message_queries import delivery_states

__all__ = ['delivery_states']

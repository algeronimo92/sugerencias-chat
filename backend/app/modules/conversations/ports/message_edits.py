"""Consumer contract: only the operations used outside this capability."""

from app.modules.conversations.message_edits import (
    set_message_reaction,
)

__all__ = ['set_message_reaction']

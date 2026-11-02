"""Contrato de ``conversations`` para otros módulos: sus eventos."""

from app.modules.conversations.domain.events import (
    ChatMarkedUnread,
    ChatRead,
    ConversationEvent,
    ExternalMessageDetected,
    InternalNoteWritten,
    MessageDiscarded,
    MessageFailed,
    MessageSent,
    OutboundQueued,
    NoteMentionsAdded,
    NoteMentionsRead,
    ProviderMessageStored,
)

__all__ = [
    "ChatMarkedUnread",
    "ChatRead",
    "ConversationEvent",
    "ExternalMessageDetected",
    "InternalNoteWritten",
    "MessageDiscarded",
    "MessageFailed",
    "MessageSent",
    "OutboundQueued",
    "NoteMentionsAdded",
    "NoteMentionsRead",
    "ProviderMessageStored",
]

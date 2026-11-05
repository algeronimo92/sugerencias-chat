"""Contrato de ``conversations`` para otros módulos: sus eventos y la
creación de notas internas (citas agendadas desde el lead)."""

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
from app.modules.conversations.internal_notes_service import NoteAuthor, create_note

__all__ = [
    "ChatMarkedUnread",
    "ChatRead",
    "ConversationEvent",
    "create_note",
    "ExternalMessageDetected",
    "InternalNoteWritten",
    "MessageDiscarded",
    "MessageFailed",
    "MessageSent",
    "NoteAuthor",
    "OutboundQueued",
    "NoteMentionsAdded",
    "NoteMentionsRead",
    "ProviderMessageStored",
]

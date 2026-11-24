"""Contrato de ``conversations`` para otros módulos: sus eventos y la
creación de notas internas (citas agendadas desde el lead), y los prefijos
con los que se reconoce de dónde salió un mensaje (lo usa el dashboard)."""

from app.modules.conversations.domain.events import (
    CallEnded,
    CallRinging,
    ChatMarkedUnread,
    ChatRead,
    ConversationEvent,
    ExternalMessageDetected,
    InternalNoteWritten,
    MessageDiscarded,
    MessageFailed,
    MessageSent,
    MessageStatusChanged,
    OutboundQueued,
    NoteMentionsAdded,
    NoteMentionsRead,
    ProviderMessageStored,
)
from app.modules.conversations.domain.origin import AUTOMATION_KEY_PREFIX, SCHEDULED_KEY_PREFIX
from app.modules.conversations.internal_notes_service import NoteAuthor, create_note

__all__ = [
    "CallEnded",
    "CallRinging",
    "AUTOMATION_KEY_PREFIX",
    "SCHEDULED_KEY_PREFIX",
    "ChatMarkedUnread",
    "ChatRead",
    "ConversationEvent",
    "create_note",
    "ExternalMessageDetected",
    "InternalNoteWritten",
    "MessageDiscarded",
    "MessageFailed",
    "MessageSent",
    "MessageStatusChanged",
    "NoteAuthor",
    "OutboundQueued",
    "NoteMentionsAdded",
    "NoteMentionsRead",
    "ProviderMessageStored",
]

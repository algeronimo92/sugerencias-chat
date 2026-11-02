"""Eventos de la conversación. Tiempo real, tareas y automatizaciones los
siguen sin que la conversación los conozca."""

from __future__ import annotations

from dataclasses import dataclass

from app.core.events import DomainEvent


@dataclass(frozen=True, kw_only=True)
class ConversationEvent(DomainEvent):
    chat_id: str


@dataclass(frozen=True, kw_only=True)
class OutboundQueued(ConversationEvent):
    """Mensajes nuevos (o reintentados) esperando al worker del outbox."""

    message_ids: tuple[int, ...]


@dataclass(frozen=True, kw_only=True)
class MessageSent(ConversationEvent):
    message_id: int
    # Quién lo mandó desde la app; None si fue una automatización o un programado.
    actor_user_id: int | None
    scheduled: bool = False


@dataclass(frozen=True, kw_only=True)
class MessageFailed(ConversationEvent):
    """Se agotaron los intentos o el fallo fue definitivo."""

    message_id: int
    scheduled: bool = False


@dataclass(frozen=True, kw_only=True)
class MessageDiscarded(ConversationEvent):
    message_id: int


@dataclass(frozen=True, kw_only=True)
class ProviderMessageStored(ConversationEvent):
    """Llegó por el webhook un mensaje nuevo: del cliente, o un eco de lo que
    el negocio mandó desde el teléfono."""

    message_id: int
    wa_message_id: str
    inbound: bool
    # Los avisos de sistema de Meta no son algo que dijo una persona: no
    # disparan automatizaciones.
    conversational: bool


@dataclass(frozen=True, kw_only=True)
class ExternalMessageDetected(ConversationEvent):
    """Un mensaje que no entró por el webhook ni por la app (lo insertó otro
    sistema) y que el vigilante de chats descubrió."""

    message: dict


@dataclass(frozen=True, kw_only=True)
class ExternalMessagesSynced(ConversationEvent):
    """Fin de una pasada del vigilante: ``latest`` es el último mensaje."""

    latest: dict


@dataclass(frozen=True, kw_only=True)
class MessageStatusChanged(ConversationEvent):
    message_id: int
    meta_status: str


@dataclass(frozen=True, kw_only=True)
class ReactionChanged(ConversationEvent):
    pass


@dataclass(frozen=True, kw_only=True)
class MessageMediaReady(ConversationEvent):
    message_id: int


@dataclass(frozen=True, kw_only=True)
class MessagePinChanged(ConversationEvent):
    message_id: int


@dataclass(frozen=True, kw_only=True)
class ChatRead(ConversationEvent):
    pass


@dataclass(frozen=True, kw_only=True)
class ChatMarkedUnread(ConversationEvent):
    pass


@dataclass(frozen=True, kw_only=True)
class ScheduledMessageChanged(ConversationEvent):
    status: str


@dataclass(frozen=True, kw_only=True)
class InternalNotesChanged(ConversationEvent):
    pass


@dataclass(frozen=True, kw_only=True)
class InternalNoteWritten(ConversationEvent):
    """Se creó, editó o borró una nota: queda en la auditoría del lead."""

    note_id: int
    action: str  # created | updated | deleted
    actor_user_id: int
    old_content: str | None
    new_content: str | None
    mention_ids: tuple[int, ...]


@dataclass(frozen=True, kw_only=True)
class NoteMentionsAdded(ConversationEvent):
    note: dict
    user_ids: tuple[int, ...]
    author_id: int
    author_name: str


@dataclass(frozen=True, kw_only=True)
class NoteMentionsRead(ConversationEvent):
    user_id: int
    mentions_changed: bool

"""Puertos de salida de los casos de uso de la conversación.

La aplicación decide; estas interfaces persisten y hablan con el canal. Las
implementaciones (PostgreSQL, Meta) se conectan en ``app.composition`` y los
tests usan dobles en memoria.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Protocol

from app.integrations.whatsapp.channel import SendReceipt, WhatsAppChannel


class OutboxStore(Protocol):
    async def queued_by_dedupe_key(self, keys: list[str]) -> dict[str, dict]:
        """Mensajes ya encolados con esas claves, serializados."""

    async def queue(
        self, chat_id: str, item: dict, *, sent_at: datetime, sent_by_user_id: int | None,
        actor_user_id: int | None,
    ) -> dict:
        """Guarda el mensaje y su trabajo; devuelve el mensaje serializado."""

    async def reopen_failed(self, chat_id: str, message_id: int, now: datetime) -> dict | None: ...

    async def discard_failed(self, chat_id: str, message_id: int, now: datetime) -> dict | None: ...

    async def mark_sent(self, job: dict, receipt: SendReceipt, now: datetime) -> bool:
        """Registra el envío. True si el mensaje venía de un programado."""

    async def mark_failed(
        self, job: dict, *, error: str, attempts: int, exhausted: bool, now: datetime,
    ) -> tuple[bool, bool]:
        """Registra el fallo si el trabajo seguía en curso. Devuelve
        ``(aplicado, venía_de_un_programado)``."""


class InboxState(Protocol):
    async def touch_human_reply(self, chat_id: str, at: datetime) -> None:
        """Un vendedor respondió: cuenta como que vio el chat."""

    async def touch_automated_reply(self, chat_id: str, at: datetime) -> None:
        """Respondió un bot: no implica que alguien del equipo lo vio."""

    async def touch_last_message(self, chat_id: str, at: datetime) -> None: ...

    async def mark_read(self, chat_id: str, at: datetime) -> None: ...

    async def mark_unread(self, chat_id: str) -> bool:
        """Retrocede la lectura hasta justo antes del último mensaje del
        cliente. False si el chat no tiene mensajes del cliente."""


class MessageStore(Protocol):
    async def insert_provider_message(self, **values: Any) -> tuple[dict, bool]: ...

    async def set_media_url(self, message_id: int, media_url: str) -> None: ...

    async def set_payload(self, message_id: int, payload: dict | None) -> None: ...

    async def record_status_event(
        self, status: dict, *, occurred_at: datetime | None, webhook_event_id: str | None,
    ) -> dict | None: ...

    async def record_reaction_event(self, **values: Any) -> bool: ...

    async def apply_reaction(
        self, chat_id: str, target_wa_message_id: str, emoji: str, *, from_me: bool,
    ) -> dict | None: ...

    async def pin(self, chat_id: str, message_id: int, user_id: int, at: datetime) -> dict | None: ...

    async def unpin(self, chat_id: str, message_id: int) -> dict | None: ...


class ScheduledStore(Protocol):
    async def create(self, lead_id: str, text: str, scheduled_at: datetime, user_id: int) -> dict | None:
        """``None`` si el lead no existe."""

    async def lock(self, scheduled_id: int) -> dict | None: ...

    async def cancel(self, scheduled_id: int, now: datetime) -> None: ...

    async def lock_for_dispatch(self, scheduled_id: int) -> dict | None:
        """El programado en ``processing``, con su fila bloqueada."""

    async def fail(self, scheduled_id: int, error: str, now: datetime) -> None: ...

    async def mark_queued(self, scheduled_id: int, message_id: int, now: datetime) -> None: ...

    async def recover_stale(self) -> None: ...

    async def claim_due(self) -> list[int]: ...


class MessageContract(Protocol):
    """Lo que el proveedor acepta: el cuerpo de cada mensaje es el de Meta."""

    async def prepare(self, items: list[dict]) -> list[dict]:
        """Valida cada ítem y le agrega el contexto de cita. Levanta
        ``OutboundRejected`` si el proveedor no lo aceptaría."""

    def subtype(self, message: dict) -> str | None: ...

    def text(self, text: str) -> dict:
        """Ítem de texto listo para encolar."""

    def reaction(self, target_wa_message_id: str, emoji: str) -> dict:
        """Cuerpo final de una reacción (no pasa por el outbox)."""


class WindowReader(Protocol):
    async def __call__(self, chat_id: str) -> dict | None: ...


@dataclass
class ConversationPorts:
    outbox: OutboxStore
    inbox: InboxState
    messages: MessageStore
    scheduled: ScheduledStore
    contract: MessageContract
    service_window: WindowReader
    channel: Any  # () -> WhatsAppChannel

    def current_channel(self) -> WhatsAppChannel:
        return self.channel()


_ports: ConversationPorts | None = None


def provide_conversation_ports(ports: ConversationPorts) -> None:
    global _ports
    _ports = ports


def conversation_ports() -> ConversationPorts:
    if _ports is None:
        raise RuntimeError("No hay puertos de conversación configurados (ver app.composition)")
    return _ports

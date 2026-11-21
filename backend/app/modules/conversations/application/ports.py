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

    async def fill_unavailable(self, message_id: int, **values: Any) -> dict | None:
        """Le pone el contenido real al aviso de "mensaje no disponible" que
        Meta mandó antes. ``None`` si ese mensaje ya no es el aviso."""
        ...

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

    async def apply_edit(
        self, chat_id: str, message_id: int, content: str | None, edited_at: datetime,
    ) -> bool:
        """True si el texto cambió; una edición vieja no pisa una más nueva."""
        ...

    async def apply_revoke(self, chat_id: str, message_id: int, deleted_at: datetime) -> bool:
        """True si el mensaje recién quedó eliminado."""
        ...


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


class CallStore(Protocol):
    """Las llamadas de WhatsApp. Cada transición es condicional: devuelve la
    fila solo si la cambió, para que un evento repetido no se cuente dos veces."""

    async def insert_ringing(self, **values: Any) -> tuple[dict, bool]:
        """Crea la llamada entrante; si el ``wacid`` ya existe, la devuelve sin tocarla."""

    async def insert_dialing(self, *, chat_id: str, phone_number_id: str, user_id: int, client_id: str, at: datetime) -> dict:
        """Crea la llamada saliente. Levanta ``CallInProgress`` o ``AgentBusy``
        si el chat o la persona ya tienen una llamada viva."""

    async def set_wa_call_id(self, call_id: int, wa_call_id: str) -> None: ...

    async def advance_outbound(self, call_id: int, *, status: str | None, sdp: str | None, at: datetime) -> dict | None:
        """``dialing``/``ringing`` → ``ringing``/``accepted``; guarda la
        respuesta de audio del cliente si vino."""

    async def get(self, call_id: int) -> dict | None: ...

    async def get_by_wa_call_id(self, wa_call_id: str) -> dict | None: ...

    async def claim(self, call_id: int, *, user_id: int, client_id: str, until: datetime) -> dict | None:
        """``ringing`` → ``connecting``. Levanta ``AgentBusy`` si la persona ya está en otra."""

    async def release(self, call_id: int, *, user_id: int) -> dict | None:
        """``connecting`` → ``ringing``, solo si la reclamó esa persona."""

    async def mark_accepted(self, call_id: int, *, user_id: int, at: datetime) -> dict | None: ...

    async def finish(
        self, call_id: int, *, status: str, cause: str | None, error_code: str | None,
        ended_at: datetime, accepted_at: datetime | None, duration_seconds: int | None,
        closed_by: str | None,
    ) -> dict | None:
        """Cierra una llamada viva, o corrige un cierre del ciclo de limpieza
        cuando llega el de Meta (``closed_by`` nulo)."""

    async def dismiss(self, call_id: int, user_id: int) -> dict | None:
        """Agrega a la persona a quienes la ignoraron, si sigue sonando."""

    async def append_event(self, call_id: int, event: dict) -> None: ...

    async def ringing(self) -> list[dict]: ...

    async def unanswered_streak(self, chat_id: str) -> int:
        """Llamadas salientes seguidas que el cliente no contestó, contando desde la última."""

    async def for_chat(self, chat_id: str, limit: int) -> list[dict]: ...

    async def stale(self, *, ringing_before: datetime, claim_expired_at: datetime, accepted_before: datetime) -> list[dict]: ...


class CallAgents(Protocol):
    async def __call__(self) -> list[dict]:
        """Quienes atienden llamadas hoy: ``{id, name}``."""


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
    calls: CallStore | None = None
    call_agents: CallAgents | None = None

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

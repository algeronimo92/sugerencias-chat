from dataclasses import dataclass, field
from typing import Protocol

UNCONFIRMED_DELIVERY_MESSAGE = (
    "No se pudo confirmar si el mensaje llegó al cliente. Si lo reintentás, "
    "podría recibirlo dos veces."
)


class ChannelError(Exception):
    user_message: str | None = None

    def __init__(self, message: str, *, status_code: int | None = None):
        super().__init__(message)
        self.status_code = status_code


class DeliveryUnconfirmedError(ChannelError):
    def __init__(self, message: str = UNCONFIRMED_DELIVERY_MESSAGE, *, status_code: int | None = None):
        super().__init__(message, status_code=status_code)
        self.user_message = message


def describe_send_failure(exc: Exception, action: str) -> str:
    if isinstance(exc, ChannelError) and exc.user_message:
        return exc.user_message
    return f"No se pudo {action}. Probá de nuevo en unos segundos."


@dataclass(frozen=True)
class SendReceipt:
    """Resultado de un envío: el id que asignó Meta, el cuerpo exacto que se
    mandó y el ``wa_id`` con el que Meta identificó al destinatario."""

    provider_message_id: str | None
    sent_body: dict = field(default_factory=dict)
    recipient_wa_id: str | None = None


class MessageSender(Protocol):
    async def send(self, chat_id: str, message: dict) -> SendReceipt: ...

    async def upload_media(self, content: bytes, content_type: str, filename: str) -> str: ...


class ConversationActions(Protocol):
    async def mark_read(self, chat_id: str, provider_message_ids: list[str]) -> None: ...


@dataclass(frozen=True)
class ChannelAvailability:
    """Si el canal puede operar, y con qué nombre se presenta.

    `reason` explica en términos del proveedor qué falta configurar, así que
    lo redacta cada adaptador: quién lo lee no sabe cuál está conectado.
    """

    integration: str | None
    configured: bool
    reason: str | None = None


class ChannelStatus(Protocol):
    async def availability(self) -> ChannelAvailability: ...


@dataclass(frozen=True)
class WhatsAppChannel:
    name: str
    sender: MessageSender
    actions: ConversationActions
    status: ChannelStatus

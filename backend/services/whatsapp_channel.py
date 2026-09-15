from dataclasses import dataclass
from datetime import datetime
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
    provider_message_id: str | None
    recipient_jid: str | None = None


@dataclass(frozen=True)
class ReactionTarget:
    chat_id: str
    provider_message_id: str
    from_me: bool


class MessageSender(Protocol):
    async def send_text(self, chat_id: str, text: str, quoted: dict | None = None) -> SendReceipt: ...

    async def send_media(
        self,
        chat_id: str,
        content: bytes,
        content_type: str,
        mediatype: str,
        *,
        filename: str | None = None,
        caption: str | None = None,
        quoted: dict | None = None,
    ) -> SendReceipt: ...

    async def send_audio(
        self, chat_id: str, content: bytes, content_type: str, filename: str | None = None, quoted: dict | None = None,
    ) -> SendReceipt: ...

    async def send_sticker(self, chat_id: str, sticker_bytes: bytes) -> SendReceipt: ...

    async def send_location(
        self, chat_id: str, latitude: float, longitude: float, quoted: dict | None = None,
    ) -> SendReceipt: ...

    async def send_template(self, chat_id: str, name: str, language: str, components: list[dict]) -> SendReceipt: ...

    async def send_buttons(
        self, chat_id: str, title: str, description: str, footer: str, buttons: list[dict],
    ) -> SendReceipt: ...

    async def send_list(
        self, chat_id: str, title: str, description: str, footer: str, button_text: str, sections: list[dict],
    ) -> SendReceipt: ...


class ConversationActions(Protocol):
    async def react(self, target: ReactionTarget, emoji: str) -> None: ...

    async def mark_read(self, chat_id: str, provider_message_ids: list[str]) -> None: ...


class MessageEditor(Protocol):
    async def edit(self, chat_id: str, provider_message_id: str, text: str) -> None: ...

    async def delete(self, chat_id: str, provider_message_id: str) -> None: ...


class HistoryReader(Protocol):
    async def is_available(self) -> bool: ...

    async def fetch(self, chat_id: str, page: int | None, before_ts: datetime | None) -> dict: ...


@dataclass(frozen=True)
class WhatsAppChannel:
    name: str
    sender: MessageSender
    actions: ConversationActions
    editor: MessageEditor | None = None
    history: HistoryReader | None = None

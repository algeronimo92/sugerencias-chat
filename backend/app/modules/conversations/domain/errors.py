"""Errores de la conversación, con el status y el texto que ya veía el cliente."""

from __future__ import annotations

from app.core.errors import Conflict, NotFound
from app.modules.conversations.domain.reactions import MAX_PINNED_MESSAGES
from app.modules.conversations.domain.service_window import (
    SERVICE_WINDOW_CLOSED_DETAIL,
    SERVICE_WINDOW_ERROR_CODE,
)


class ServiceWindowClosed(Conflict):
    code = SERVICE_WINDOW_ERROR_CODE

    def __init__(self) -> None:
        super().__init__(SERVICE_WINDOW_CLOSED_DETAIL)


class ChatNotFound(NotFound):
    code = "chat_not_found"

    def __init__(self) -> None:
        super().__init__("Lead no encontrado")


class MessageNotFound(NotFound):
    code = "message_not_found"

    def __init__(self, detail: str = "El mensaje no existe en este chat") -> None:
        super().__init__(detail)


class MessageNotConfirmed(Conflict):
    """El mensaje sigue en el outbox: todavía no tiene id de WhatsApp."""

    code = "message_not_confirmed"


class NotRetryable(Conflict):
    code = "message_not_retryable"

    def __init__(self) -> None:
        super().__init__("El mensaje no está fallido o ya fue reintentado")


class PinLimitReached(Conflict):
    code = "pin_limit_reached"

    def __init__(self) -> None:
        super().__init__(f"Ya hay {MAX_PINNED_MESSAGES} mensajes fijados en este chat. Desfijá uno primero.")

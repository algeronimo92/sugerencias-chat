"""Consulta de la ventana de 24 h de un chat. La regla vive en
``domain/service_window.py``; acá solo se lee el último mensaje del cliente."""

from app.modules.conversations.chat_queries import get_customer_service_window
from app.modules.conversations.domain.service_window import (
    SERVICE_WINDOW_CLOSED_DETAIL,
    SERVICE_WINDOW_CLOSED_ERROR,
    SERVICE_WINDOW_ERROR_CODE,
    window_is_open,
)

__all__ = [
    "SERVICE_WINDOW_CLOSED_DETAIL",
    "SERVICE_WINDOW_CLOSED_ERROR",
    "SERVICE_WINDOW_ERROR_CODE",
    "service_window_is_open",
    "window_is_open",
]


async def service_window_is_open(chat_id: str) -> bool:
    return window_is_open(await get_customer_service_window(chat_id))

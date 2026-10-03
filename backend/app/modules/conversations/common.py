from fastapi import APIRouter

from app.modules.conversations.chat_queries import lead_exists
from app.modules.conversations.domain.errors import ChatNotFound, ServiceWindowClosed
from app.modules.conversations.service_window import service_window_is_open


ROUTER_PREFIX = "/api/chats"
ROUTER_TAGS = ["chats"]


def chats_router() -> APIRouter:
    return APIRouter(prefix=ROUTER_PREFIX, tags=ROUTER_TAGS)


async def _require_existing_lead(chat_id: str) -> None:
    if not await lead_exists(chat_id):
        raise ChatNotFound()


async def _require_open_service_window(chat_id: str) -> None:
    """Corta el envío libre antes de encolarlo.

    Sin esto el mensaje se encola, se pinta la burbuja y recién falla cuando
    Meta lo rechaza: al vendedor le queda un "no enviado" con un botón de
    reintento que no puede funcionar nunca hasta que el cliente escriba.
    """
    if not await service_window_is_open(chat_id):
        raise ServiceWindowClosed()

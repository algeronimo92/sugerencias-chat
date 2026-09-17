from fastapi import APIRouter, HTTPException
from services.db_service import lead_exists
from services.service_window import SERVICE_WINDOW_CLOSED_DETAIL, service_window_is_open


ROUTER_PREFIX = "/api/chats"
ROUTER_TAGS = ["chats"]


def chats_router() -> APIRouter:
    return APIRouter(prefix=ROUTER_PREFIX, tags=ROUTER_TAGS)


async def _require_existing_lead(chat_id: str) -> None:
    if not await lead_exists(chat_id):
        raise HTTPException(404, "Lead no encontrado")


async def _require_open_service_window(chat_id: str) -> None:
    """Corta el envío libre antes de encolarlo.

    Sin esto el mensaje se encola, se pinta la burbuja y recién falla cuando
    Meta lo rechaza: al vendedor le queda un "no enviado" con un botón de
    reintento que no puede funcionar nunca hasta que el cliente escriba.
    """
    if not await service_window_is_open(chat_id):
        raise HTTPException(409, SERVICE_WINDOW_CLOSED_DETAIL)

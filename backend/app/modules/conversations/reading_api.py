import logging

from datetime import datetime
from fastapi import HTTPException, Query
from app.modules.conversations.schemas import CustomerServiceWindow, MessagePage
from app.db.store_common import MESSAGES_PAGE_SIZE
from app.modules.conversations.message_history import fetch_messages
from app.modules.conversations.chat_queries import get_customer_service_window
from app.modules.conversations.common import chats_router


router = chats_router()
logger = logging.getLogger(__name__)


@router.get("/{chat_id}/messages", response_model=MessagePage)
async def get_messages(
    chat_id: str,
    cursor_ts: datetime | None = None,
    cursor_id: int | None = Query(default=None, ge=1),
    limit: int = Query(default=MESSAGES_PAGE_SIZE, ge=1, le=100),
    until_id: int | None = Query(default=None, ge=1),
):
    try:
        return await fetch_messages(chat_id, cursor_ts, cursor_id, limit, until_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        logger.exception("Error inesperado al obtener mensajes del chat %s", chat_id)
        raise HTTPException(status_code=500, detail="Error interno al obtener mensajes")


@router.get("/{chat_id}/service-window", response_model=CustomerServiceWindow)
async def get_service_window(chat_id: str):
    window = await get_customer_service_window(chat_id)
    if window is None:
        raise HTTPException(404, "Lead no encontrado")
    return window

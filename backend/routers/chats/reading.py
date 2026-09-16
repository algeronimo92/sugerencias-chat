import logging

from datetime import datetime
from fastapi import HTTPException, Query
from models.schemas import CustomerServiceWindow, HistoryPage, MessagePage
from services.db_service import MESSAGES_PAGE_SIZE, fetch_messages, get_customer_service_window
from services.whatsapp_capabilities import HISTORY_UNSUPPORTED_DETAIL, get_whatsapp_capabilities
from services.whatsapp_channel import ChannelError, HistoryReader
from services.whatsapp_channels import current_channel
from services.whatsapp_identity_service import InvalidWhatsAppIdentityError
from routers.chats.common import chats_router


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


@router.get("/history/availability")
async def get_history_availability():
    return {"available": (await get_whatsapp_capabilities())["history_available"]}


async def _require_history() -> HistoryReader:
    history = current_channel().history
    if history is None or not await history.is_available():
        raise HTTPException(status_code=409, detail=HISTORY_UNSUPPORTED_DETAIL)
    return history


@router.get("/{chat_id}/history", response_model=HistoryPage)
async def get_whatsapp_history(
    chat_id: str,
    page: int | None = Query(default=None, ge=1),
    before_ts: datetime | None = None,
):
    """Historial anterior al registro propio, leído de WhatsApp y sin guardar."""
    history = await _require_history()
    try:
        return await history.fetch(chat_id, page, before_ts)
    except ChannelError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except InvalidWhatsAppIdentityError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/{chat_id}/service-window", response_model=CustomerServiceWindow)
async def get_service_window(chat_id: str):
    window = await get_customer_service_window(chat_id)
    if window is None:
        raise HTTPException(404, "Lead no encontrado")
    return window

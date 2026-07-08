from fastapi import APIRouter, HTTPException
from models.schemas import ChatPage, Message
from services.db_service import CHATS_PAGE_SIZE, fetch_chats, fetch_messages

router = APIRouter(prefix="/api/chats", tags=["chats"])


@router.get("", response_model=ChatPage)
async def get_chats(
    search: str | None = None,
    cursor_ts: str | None = None,
    cursor_id: str | None = None,
    limit: int = CHATS_PAGE_SIZE,
):
    try:
        return await fetch_chats(search, cursor_ts, cursor_id, limit)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{chat_id}/messages", response_model=list[Message])
async def get_messages(chat_id: str):
    try:
        rows = await fetch_messages(chat_id)
        return rows
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

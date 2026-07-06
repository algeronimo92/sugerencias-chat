from fastapi import APIRouter, HTTPException
from models.schemas import Chat, Message
from services.db_service import fetch_chats, fetch_messages

router = APIRouter(prefix="/api/chats", tags=["chats"])


@router.get("", response_model=list[Chat])
async def get_chats(search: str | None = None):
    try:
        rows = await fetch_chats(search)
        return rows
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{chat_id}/messages", response_model=list[Message])
async def get_messages(chat_id: str):
    try:
        rows = await fetch_messages(chat_id)
        return rows
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

import httpx
from fastapi import APIRouter, HTTPException
from models.schemas import ChatPage, Message, SendAudioRequest, SendMessageRequest
from routers.media import save_media_file
from services.db_service import CHATS_PAGE_SIZE, fetch_chats, fetch_messages, insert_message
from services.evolution_service import EvolutionApiError, send_whatsapp_audio, send_whatsapp_text
from services.ws_manager import manager

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


@router.post("/{chat_id}/messages", response_model=Message)
async def send_message(chat_id: str, body: SendMessageRequest):
    text = body.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="El mensaje no puede estar vacío")

    try:
        await send_whatsapp_text(chat_id, text)
    except EvolutionApiError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Error llamando a Evolution API: {e}")

    message = await insert_message(chat_id, sender="vendedor", content=text)
    await manager.broadcast({"type": "chats_updated"})
    return message


@router.post("/{chat_id}/audio", response_model=Message)
async def send_audio(chat_id: str, body: SendAudioRequest):
    try:
        media_url = save_media_file(body.content_type, body.data_base64)
    except ValueError as e:
        status = 413 if "grande" in str(e) else 400
        raise HTTPException(status_code=status, detail=str(e))

    try:
        await send_whatsapp_audio(chat_id, body.data_base64)
    except EvolutionApiError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Error llamando a Evolution API: {e}")

    message = await insert_message(chat_id, sender="vendedor", content="<audio></audio>", media_url=media_url)
    await manager.broadcast({"type": "chats_updated"})
    return message

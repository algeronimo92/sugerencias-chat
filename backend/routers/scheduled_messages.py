from fastapi import APIRouter, Depends, HTTPException

from db.models import User
from models.schemas import ScheduledMessageCreate, ScheduledMessageItem
from services.auth_service import get_current_user
from services.scheduled_message_service import (
    cancel_scheduled_message,
    create_scheduled_message,
    list_scheduled_messages,
)
from services.ws_manager import manager

router = APIRouter(tags=["scheduled-messages"])


@router.get(
    "/api/chats/{chat_id}/scheduled-messages",
    response_model=list[ScheduledMessageItem],
)
async def get_scheduled_messages(
    chat_id: str,
    _user: User = Depends(get_current_user),
):
    return await list_scheduled_messages(chat_id)


@router.post(
    "/api/chats/{chat_id}/scheduled-messages",
    response_model=ScheduledMessageItem,
    status_code=201,
)
async def post_scheduled_message(
    chat_id: str,
    body: ScheduledMessageCreate,
    user: User = Depends(get_current_user),
):
    text = body.text.strip()
    if not text:
        raise HTTPException(400, "El mensaje no puede estar vacío")
    try:
        item = await create_scheduled_message(
            chat_id,
            text,
            body.scheduled_at,
            user.id,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    if item is None:
        raise HTTPException(404, "Lead no encontrado")
    await manager.broadcast({
        "type": "scheduled_messages_updated",
        "chat_id": chat_id,
        "status": "scheduled",
    })
    return item


@router.delete("/api/scheduled-messages/{scheduled_id}")
async def delete_scheduled_message(
    scheduled_id: int,
    user: User = Depends(get_current_user),
):
    try:
        result = await cancel_scheduled_message(
            scheduled_id,
            user.id,
            user.role == "admin",
        )
    except PermissionError as exc:
        raise HTTPException(403, str(exc))
    except ValueError as exc:
        raise HTTPException(409, str(exc))
    if result is None:
        raise HTTPException(404, "Mensaje programado no encontrado")
    await manager.broadcast({
        "type": "scheduled_messages_updated",
        "chat_id": result["lead_id"],
        "status": "cancelled",
    })
    return {"status": "cancelled"}

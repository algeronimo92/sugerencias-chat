"""Adaptador HTTP de los mensajes programados."""

from fastapi import APIRouter, Depends, HTTPException

from app.modules.auth.public import User
from app.modules.auth.ports.auth_service import get_current_user
from app.modules.conversations.application.scheduling import cancel_scheduled_message, schedule_message
from app.modules.conversations.scheduled_queries import list_scheduled_messages
from app.modules.conversations.schemas import ScheduledMessageCreate, ScheduledMessageItem

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
    return await schedule_message(chat_id, text, body.scheduled_at, user.id)


@router.delete("/api/scheduled-messages/{scheduled_id}")
async def delete_scheduled_message(
    scheduled_id: int,
    user: User = Depends(get_current_user),
):
    await cancel_scheduled_message(scheduled_id, user.id, user.role == "admin")
    return {"status": "cancelled"}

from fastapi import APIRouter, Depends, HTTPException

from db.models import User
from models.schemas import InternalNoteCreate, InternalNoteItem, InternalNoteUpdate
from services.auth_service import get_current_user
from services.internal_notes_service import (
    create_internal_note,
    delete_internal_note,
    get_internal_note,
    list_internal_notes,
    mark_internal_mentions_read,
    update_internal_note,
)
from services.notification_service import create_mention_notifications, mark_lead_notifications_read
from services.ws_manager import manager

router = APIRouter(prefix="/api/chats/{chat_id}/notes", tags=["internal-notes"])


async def _notify_mentions(note: dict, user_ids: list[int], actor: User) -> None:
    created = await create_mention_notifications(note, user_ids, actor)
    for user_id, notification in created:
        await manager.send_to_user(user_id, {
            "type": "notification_created", "notification": notification,
        })


@router.get("", response_model=list[InternalNoteItem])
async def get_notes(chat_id: str, user: User = Depends(get_current_user)):
    notes = await list_internal_notes(chat_id)
    if notes is None:
        raise HTTPException(404, "Lead no encontrado")
    await mark_internal_mentions_read(chat_id, user.id)
    if await mark_lead_notifications_read(chat_id, user.id):
        await manager.send_to_user(user.id, {"type": "notifications_updated"})
    return notes


@router.post("", response_model=InternalNoteItem, status_code=201)
async def post_note(chat_id: str, body: InternalNoteCreate, user: User = Depends(get_current_user)):
    content = body.content.strip()
    if not content:
        raise HTTPException(400, "La nota no puede estar vacía")
    if len(content) > 5000:
        raise HTTPException(400, "La nota admite como máximo 5000 caracteres")
    try:
        note = await create_internal_note(chat_id, content, body.mentioned_user_ids, user.id)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    if note is None:
        raise HTTPException(404, "Lead no encontrado")
    await manager.broadcast({"type": "internal_notes_updated", "lead_id": chat_id})
    await _notify_mentions(note, body.mentioned_user_ids, user)
    return note


@router.patch("/{note_id}", response_model=InternalNoteItem)
async def patch_note(
    chat_id: str,
    note_id: int,
    body: InternalNoteUpdate,
    user: User = Depends(get_current_user),
):
    current = await get_internal_note(note_id)
    if current is None or current["lead_id"] != chat_id:
        raise HTTPException(404, "Nota no encontrada")
    if user.role != "admin" and current["author_user_id"] != user.id:
        raise HTTPException(403, "Solo el autor o un administrador puede editar esta nota")
    content = body.content.strip()
    if not content:
        raise HTTPException(400, "La nota no puede estar vacía")
    if len(content) > 5000:
        raise HTTPException(400, "La nota admite como máximo 5000 caracteres")
    try:
        note, new_mentions = await update_internal_note(
            note_id, content, body.mentioned_user_ids, user.id
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    if note is None:
        raise HTTPException(404, "Nota no encontrada")
    await manager.broadcast({"type": "internal_notes_updated", "lead_id": chat_id})
    await _notify_mentions(note, new_mentions, user)
    return note


@router.delete("/{note_id}")
async def delete_note(chat_id: str, note_id: int, user: User = Depends(get_current_user)):
    current = await get_internal_note(note_id)
    if current is None or current["lead_id"] != chat_id:
        raise HTTPException(404, "Nota no encontrada")
    if user.role != "admin" and current["author_user_id"] != user.id:
        raise HTTPException(403, "Solo el autor o un administrador puede eliminar esta nota")
    if await delete_internal_note(note_id, user.id) is None:
        raise HTTPException(404, "Nota no encontrada")
    await manager.broadcast({"type": "internal_notes_updated", "lead_id": chat_id})
    return {"status": "ok"}

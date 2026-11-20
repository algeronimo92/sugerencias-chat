"""Adaptador HTTP de las notas internas."""

from fastapi import APIRouter, BackgroundTasks, Depends

from app.modules.auth.public import User
from app.modules.auth.ports.auth_service import Permission, can, require_permission
from app.modules.conversations.internal_notes_service import (
    NoteAuthor,
    create_note,
    delete_note as remove_note,
    edit_note,
    list_notes,
    mark_notes_seen,
)
from app.modules.conversations.schemas import InternalNoteCreate, InternalNoteItem, InternalNoteUpdate
from app.modules.leads.ports.visibility import require_visible_lead

router = APIRouter(prefix="/api/chats/{chat_id}/notes", tags=["internal-notes"], dependencies=[Depends(require_visible_lead)])
require_conversations_view = require_permission(Permission.CONVERSATIONS_VIEW)
require_conversations_send = require_permission(Permission.CONVERSATIONS_SEND)


def _author(user: User) -> NoteAuthor:
    # ``is_admin`` deja editar y borrar notas de otros.
    return NoteAuthor(id=user.id, name=user.name, is_admin=can(user, Permission.TEAM_SUPERVISE))


@router.get("", response_model=list[InternalNoteItem])
async def get_notes(
    chat_id: str,
    background_tasks: BackgroundTasks,
    user: User = Depends(require_conversations_view),
):
    notes = await list_notes(chat_id)
    background_tasks.add_task(mark_notes_seen, chat_id, user.id)
    return notes


@router.post("", response_model=InternalNoteItem, status_code=201)
async def post_note(chat_id: str, body: InternalNoteCreate, user: User = Depends(require_conversations_send)):
    return await create_note(chat_id, body.content, body.mentioned_user_ids, _author(user))


@router.patch("/{note_id}", response_model=InternalNoteItem)
async def patch_note(
    chat_id: str,
    note_id: int,
    body: InternalNoteUpdate,
    user: User = Depends(require_conversations_send),
):
    return await edit_note(chat_id, note_id, body.content, body.mentioned_user_ids, _author(user))


@router.delete("/{note_id}")
async def delete_note(chat_id: str, note_id: int, user: User = Depends(require_conversations_send)):
    await remove_note(chat_id, note_id, _author(user))
    return {"status": "ok"}

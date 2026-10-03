"""Casos de uso de las notas internas del equipo sobre un lead.

Cada cambio es una transacción que publica eventos: la auditoría del lead la
registra ``leads`` en la misma transacción, las notificaciones de mención las
crea ``notifications`` después del commit y los paneles se enteran por el
suscriptor de tiempo real.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from app.core.errors import Forbidden, Invalid, NotFound
from app.db.uow import collect, unit_of_work
from app.modules.conversations import internal_notes_repository as notes
from app.modules.conversations.domain.events import (
    InternalNotesChanged,
    InternalNoteWritten,
    NoteMentionsAdded,
    NoteMentionsRead,
)

MAX_NOTE_LENGTH = 5000


@dataclass(frozen=True)
class NoteAuthor:
    id: int
    name: str
    is_admin: bool = False


class NoteNotFound(NotFound):
    code = "note_not_found"

    def __init__(self) -> None:
        super().__init__("Nota no encontrada")


class InvalidNote(Invalid):
    status_code = 400
    code = "invalid_note"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _clean(content: str) -> str:
    content = content.strip()
    if not content:
        raise InvalidNote("La nota no puede estar vacía")
    if len(content) > MAX_NOTE_LENGTH:
        raise InvalidNote(f"La nota admite como máximo {MAX_NOTE_LENGTH} caracteres")
    return content


async def _valid_mentions(user_ids: list[int]) -> list[int]:
    ids = list(dict.fromkeys(user_ids))
    if ids and await notes.active_user_ids(ids) != set(ids):
        raise InvalidNote("Uno o más usuarios mencionados no existen o están inactivos")
    return ids


async def _owned(lead_id: str, note_id: int, author: NoteAuthor, action: str) -> dict:
    note = await notes.lock_note(note_id)
    if note is None or note["lead_id"] != lead_id:
        raise NoteNotFound()
    if not author.is_admin and note["author_user_id"] != author.id:
        raise Forbidden(f"Solo el autor o un administrador puede {action} esta nota")
    return note


async def list_notes(lead_id: str) -> list[dict]:
    items = await notes.list_internal_notes(lead_id)
    if items is None:
        raise NotFound("Lead no encontrado")
    return items


async def create_note(lead_id: str, content: str, mentioned_user_ids: list[int], author: NoteAuthor) -> dict:
    content = _clean(content)
    async with unit_of_work():
        if not await notes.lead_exists(lead_id):
            raise NotFound("Lead no encontrado")
        mention_ids = await _valid_mentions(mentioned_user_ids)
        note_id = await notes.insert_note(lead_id, author.id, content, mention_ids, _now())
        note = await notes.get_internal_note(note_id)
        collect(
            InternalNoteWritten(
                chat_id=lead_id, note_id=note_id, action="created", actor_user_id=author.id,
                old_content=None, new_content=content, mention_ids=tuple(mention_ids),
            ),
            InternalNotesChanged(chat_id=lead_id),
        )
        if mention_ids:
            collect(NoteMentionsAdded(
                chat_id=lead_id, note=note, user_ids=tuple(mention_ids),
                author_id=author.id, author_name=author.name,
            ))
    return note


async def edit_note(
    lead_id: str, note_id: int, content: str, mentioned_user_ids: list[int], author: NoteAuthor,
) -> dict:
    content = _clean(content)
    async with unit_of_work():
        current = await _owned(lead_id, note_id, author, "editar")
        mention_ids = await _valid_mentions(mentioned_user_ids)
        added = await notes.rewrite_note(note_id, content, mention_ids, _now())
        note = await notes.get_internal_note(note_id)
        collect(
            InternalNoteWritten(
                chat_id=lead_id, note_id=note_id, action="updated", actor_user_id=author.id,
                old_content=current["content"], new_content=content, mention_ids=tuple(mention_ids),
            ),
            InternalNotesChanged(chat_id=lead_id),
        )
        if added:
            collect(NoteMentionsAdded(
                chat_id=lead_id, note=note, user_ids=tuple(added),
                author_id=author.id, author_name=author.name,
            ))
    return note


async def delete_note(lead_id: str, note_id: int, author: NoteAuthor) -> None:
    async with unit_of_work():
        current = await _owned(lead_id, note_id, author, "eliminar")
        collect(
            InternalNoteWritten(
                chat_id=lead_id, note_id=note_id, action="deleted", actor_user_id=author.id,
                old_content=current["content"], new_content=None, mention_ids=(),
            ),
            InternalNotesChanged(chat_id=lead_id),
        )
        await notes.delete_note(note_id)


async def mark_notes_seen(lead_id: str, user_id: int) -> None:
    """Quien abre las notas del lead ya vio sus menciones (y las
    notificaciones del lead, que marca ``notifications``)."""
    async with unit_of_work():
        changed = await notes.mark_mentions_read(lead_id, user_id, _now())
        collect(NoteMentionsRead(chat_id=lead_id, user_id=user_id, mentions_changed=changed))

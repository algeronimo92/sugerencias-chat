"""Persistencia de las notas internas y sus menciones.

Solo toca sus tablas (``lead_notes``, ``lead_note_mentions``). La auditoría del
lead y las notificaciones de mención las escriben sus dueños al reaccionar a
los eventos que publica ``internal_notes_service``.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import delete, insert, select, update

from app.db.models.auth import User
from app.db.models.leads import Lead, LeadNote, LeadNoteMention
from app.db.uow import session_scope
from app.modules.conversations.internal_notes_policies import _note


def _note_query():
    return (
        select(
            LeadNote.id,
            LeadNote.lead_id,
            LeadNote.author_user_id,
            User.name.label("author_name"),
            LeadNote.content,
            LeadNote.created_at,
            LeadNote.updated_at,
        )
        .join(User, User.id == LeadNote.author_user_id)
    )


async def _mentions_for_notes(session, note_ids: list[int]) -> dict[int, list[dict]]:
    if not note_ids:
        return {}
    rows = (await session.execute(
        select(LeadNoteMention.note_id, User.id.label("user_id"), User.name.label("user_name"))
        .join(User, User.id == LeadNoteMention.user_id)
        .where(LeadNoteMention.note_id.in_(note_ids))
        .order_by(User.name)
    )).mappings().all()
    result: dict[int, list[dict]] = {}
    for row in rows:
        result.setdefault(row["note_id"], []).append({"user_id": row["user_id"], "user_name": row["user_name"]})
    return result


async def list_internal_notes(lead_id: str) -> list[dict] | None:
    async with session_scope() as session:
        rows = (await session.execute(
            _note_query().where(LeadNote.lead_id == lead_id)
            .order_by(LeadNote.created_at.asc(), LeadNote.id.asc())
        )).mappings().all()
        if not rows and await session.get(Lead, lead_id) is None:
            return None
        mentions = await _mentions_for_notes(session, [row["id"] for row in rows])
    return [_note(row, mentions.get(row["id"])) for row in rows]


async def get_internal_note(note_id: int) -> dict | None:
    async with session_scope() as session:
        row = (await session.execute(_note_query().where(LeadNote.id == note_id))).mappings().one_or_none()
        if row is None:
            return None
        mentions = await _mentions_for_notes(session, [note_id])
    return _note(row, mentions.get(note_id))


async def lead_exists(lead_id: str) -> bool:
    async with session_scope() as session:
        return await session.get(Lead, lead_id) is not None


async def active_user_ids(user_ids: list[int]) -> set[int]:
    if not user_ids:
        return set()
    async with session_scope() as session:
        return set((await session.execute(
            select(User.id).where(User.id.in_(user_ids), User.is_active.is_(True))
        )).scalars().all())


async def insert_note(lead_id: str, author_user_id: int, content: str, mention_ids: list[int], now: datetime) -> int:
    async with session_scope() as session:
        note_id = (await session.execute(
            insert(LeadNote).values(
                lead_id=lead_id, author_user_id=author_user_id, content=content,
                created_at=now, updated_at=now,
            ).returning(LeadNote.id)
        )).scalar_one()
        if mention_ids:
            await session.execute(insert(LeadNoteMention), [
                {"note_id": note_id, "user_id": user_id, "created_at": now} for user_id in mention_ids
            ])
        return note_id


async def lock_note(note_id: int) -> dict | None:
    async with session_scope() as session:
        note = await session.get(LeadNote, note_id, with_for_update=True)
        if note is None:
            return None
        return {"id": note.id, "lead_id": note.lead_id, "author_user_id": note.author_user_id, "content": note.content}


async def rewrite_note(note_id: int, content: str, mention_ids: list[int], now: datetime) -> list[int]:
    """Cambia el texto y las menciones. Devuelve los mencionados nuevos."""
    async with session_scope() as session:
        previous_ids = set((await session.execute(
            select(LeadNoteMention.user_id).where(LeadNoteMention.note_id == note_id)
        )).scalars().all())
        await session.execute(update(LeadNote).where(LeadNote.id == note_id).values(content=content, updated_at=now))
        removed_ids = previous_ids - set(mention_ids)
        added_ids = [user_id for user_id in mention_ids if user_id not in previous_ids]
        if removed_ids:
            await session.execute(delete(LeadNoteMention).where(
                LeadNoteMention.note_id == note_id, LeadNoteMention.user_id.in_(removed_ids),
            ))
        if added_ids:
            await session.execute(insert(LeadNoteMention), [
                {"note_id": note_id, "user_id": user_id, "created_at": now} for user_id in added_ids
            ])
        return added_ids


async def delete_note(note_id: int) -> None:
    async with session_scope() as session:
        await session.execute(delete(LeadNote).where(LeadNote.id == note_id))


async def mark_mentions_read(lead_id: str, user_id: int, now: datetime) -> bool:
    note_ids = select(LeadNote.id).where(LeadNote.lead_id == lead_id)
    async with session_scope() as session:
        result = await session.execute(
            update(LeadNoteMention)
            .where(
                LeadNoteMention.user_id == user_id,
                LeadNoteMention.read_at.is_(None),
                LeadNoteMention.note_id.in_(note_ids),
            )
            .values(read_at=now)
        )
        return bool(result.rowcount)

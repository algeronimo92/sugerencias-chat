from datetime import datetime, timezone

from sqlalchemy import delete, insert, select, update

from db.models import Lead, LeadActivity, LeadNote, LeadNoteMention, User, UserNotification
from db.session import get_sessionmaker


def _ts(value: datetime) -> str:
    return value.isoformat().replace("+00:00", "Z")


def _note(row, mentions: list[dict] | None = None) -> dict:
    return {
        "id": row["id"],
        "lead_id": row["lead_id"],
        "author_user_id": row["author_user_id"],
        "author_name": row["author_name"],
        "content": row["content"],
        "created_at": _ts(row["created_at"]),
        "updated_at": _ts(row["updated_at"]),
        "is_edited": row["updated_at"] > row["created_at"],
        "mentions": mentions or [],
    }


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
        result.setdefault(row["note_id"], []).append({
            "user_id": row["user_id"], "user_name": row["user_name"],
        })
    return result


async def list_internal_notes(lead_id: str) -> list[dict] | None:
    async with get_sessionmaker()() as session:
        rows = (await session.execute(
            _note_query().where(LeadNote.lead_id == lead_id)
            .order_by(LeadNote.created_at.asc(), LeadNote.id.asc())
        )).mappings().all()
        if not rows and await session.get(Lead, lead_id) is None:
            return None
        mentions = await _mentions_for_notes(session, [row["id"] for row in rows])
    return [_note(row, mentions.get(row["id"])) for row in rows]


async def get_internal_note(note_id: int) -> dict | None:
    async with get_sessionmaker()() as session:
        row = (await session.execute(_note_query().where(LeadNote.id == note_id))).mappings().one_or_none()
        if row is None:
            return None
        mentions = await _mentions_for_notes(session, [note_id])
    return _note(row, mentions.get(note_id))


async def _validate_mentions(session, mentioned_user_ids: list[int]) -> list[int]:
    ids = list(dict.fromkeys(mentioned_user_ids))
    if not ids:
        return []
    valid_ids = set((await session.execute(
        select(User.id).where(User.id.in_(ids), User.is_active.is_(True))
    )).scalars().all())
    if valid_ids != set(ids):
        raise ValueError("Uno o más usuarios mencionados no existen o están inactivos")
    return ids


async def create_internal_note(
    lead_id: str,
    content: str,
    mentioned_user_ids: list[int],
    author_user_id: int,
) -> dict | None:
    now = datetime.now(timezone.utc)
    async with get_sessionmaker()() as session:
        if await session.get(Lead, lead_id) is None:
            return None
        mention_ids = await _validate_mentions(session, mentioned_user_ids)
        note_id = (await session.execute(
            insert(LeadNote).values(
                lead_id=lead_id,
                author_user_id=author_user_id,
                content=content,
                created_at=now,
                updated_at=now,
            ).returning(LeadNote.id)
        )).scalar_one()
        if mention_ids:
            await session.execute(insert(LeadNoteMention), [
                {"note_id": note_id, "user_id": user_id, "created_at": now}
                for user_id in mention_ids
            ])
        await session.execute(insert(LeadActivity).values(
            lead_id=lead_id,
            event_type="internal_note_created",
            actor_type="user",
            actor_user_id=author_user_id,
            old_value=None,
            new_value={"content": content},
            metadata_={"note_id": note_id, "mentioned_user_ids": mention_ids},
            created_at=now,
        ))
        await session.commit()
    return await get_internal_note(note_id)


async def update_internal_note(
    note_id: int,
    content: str,
    mentioned_user_ids: list[int],
    actor_user_id: int,
) -> tuple[dict | None, list[int]]:
    now = datetime.now(timezone.utc)
    async with get_sessionmaker()() as session:
        note = await session.get(LeadNote, note_id)
        if note is None:
            return None, []
        mention_ids = await _validate_mentions(session, mentioned_user_ids)
        previous_ids = set((await session.execute(
            select(LeadNoteMention.user_id).where(LeadNoteMention.note_id == note_id)
        )).scalars().all())
        old_content = note.content
        note.content = content
        note.updated_at = now
        removed_ids = previous_ids - set(mention_ids)
        added_ids = set(mention_ids) - previous_ids
        if removed_ids:
            await session.execute(
                delete(LeadNoteMention).where(
                    LeadNoteMention.note_id == note_id,
                    LeadNoteMention.user_id.in_(removed_ids),
                )
            )
        if added_ids:
            await session.execute(insert(LeadNoteMention), [
                {"note_id": note_id, "user_id": user_id, "created_at": now}
                for user_id in added_ids
            ])
        await session.execute(insert(LeadActivity).values(
            lead_id=note.lead_id,
            event_type="internal_note_updated",
            actor_type="user",
            actor_user_id=actor_user_id,
            old_value={"content": old_content},
            new_value={"content": content},
            metadata_={"note_id": note_id, "mentioned_user_ids": mention_ids},
            created_at=now,
        ))
        await session.commit()
    item = await get_internal_note(note_id)
    return item, list(added_ids)


async def delete_internal_note(note_id: int, actor_user_id: int) -> dict | None:
    async with get_sessionmaker()() as session:
        note = await session.get(LeadNote, note_id)
        if note is None:
            return None
        deleted = {"lead_id": note.lead_id, "content": note.content}
        await session.execute(insert(LeadActivity).values(
            lead_id=note.lead_id,
            event_type="internal_note_deleted",
            actor_type="user",
            actor_user_id=actor_user_id,
            old_value={"content": note.content},
            new_value=None,
            metadata_={"note_id": note_id},
            created_at=datetime.now(timezone.utc),
        ))
        await session.delete(note)
        await session.commit()
    return deleted


async def mark_internal_mentions_read(lead_id: str, user_id: int) -> None:
    note_ids = select(LeadNote.id).where(LeadNote.lead_id == lead_id)
    async with get_sessionmaker()() as session:
        await session.execute(
            update(LeadNoteMention)
            .where(
                LeadNoteMention.user_id == user_id,
                LeadNoteMention.read_at.is_(None),
                LeadNoteMention.note_id.in_(note_ids),
            )
            .values(read_at=datetime.now(timezone.utc))
        )
        await session.commit()


async def mark_note_views_read(lead_id: str, user_id: int) -> bool:
    """Marca menciones y notificaciones del lead en una sola transacción."""
    note_ids = select(LeadNote.id).where(LeadNote.lead_id == lead_id)
    now = datetime.now(timezone.utc)
    async with get_sessionmaker()() as session:
        mention_result = await session.execute(
            update(LeadNoteMention)
            .where(
                LeadNoteMention.user_id == user_id,
                LeadNoteMention.read_at.is_(None),
                LeadNoteMention.note_id.in_(note_ids),
            )
            .values(read_at=now)
        )
        notification_result = await session.execute(
            update(UserNotification)
            .where(
                UserNotification.user_id == user_id,
                UserNotification.lead_id == lead_id,
                UserNotification.read_at.is_(None),
            )
            .values(read_at=now)
        )
        changed = bool(mention_result.rowcount or notification_result.rowcount)
        if changed:
            await session.commit()
        else:
            await session.rollback()
    return changed

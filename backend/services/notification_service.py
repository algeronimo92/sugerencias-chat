from datetime import datetime, timezone

from sqlalchemy import func, insert, select, update

from domain_types import NotificationType
from db.models import UserNotification
from db.session import get_sessionmaker


def _ts(value):
    return value.isoformat().replace("+00:00", "Z") if value else None


def _notification(row) -> dict:
    return {
        "id": row.id,
        "notification_type": row.notification_type,
        "title": row.title,
        "body": row.body,
        "lead_id": row.lead_id,
        "source_id": row.source_id,
        "metadata": row.metadata_,
        "read_at": _ts(row.read_at),
        "created_at": _ts(row.created_at),
    }


async def create_system_notification(
    user_id: int,
    notification_type: NotificationType,
    title: str,
    body: str,
    lead_id: str | None = None,
    source_id: str | None = None,
    metadata: dict | None = None,
) -> dict:
    now = datetime.now(timezone.utc)
    async with get_sessionmaker()() as session:
        notification_id = (await session.execute(
            insert(UserNotification).values(
                user_id=user_id,
                notification_type=notification_type,
                title=title,
                body=body,
                lead_id=lead_id,
                source_id=source_id,
                metadata_=metadata or {},
                read_at=None,
                created_at=now,
            ).returning(UserNotification.id)
        )).scalar_one()
        await session.commit()
        row = await session.get(UserNotification, notification_id)
    return _notification(row)


async def create_mention_notifications(note: dict, user_ids: list[int], actor) -> list[tuple[int, dict]]:
    recipients = [user_id for user_id in dict.fromkeys(user_ids) if user_id != actor.id]
    if not recipients:
        return []
    now = datetime.now(timezone.utc)
    created: list[tuple[int, int]] = []
    async with get_sessionmaker()() as session:
        for user_id in recipients:
            notification_id = (await session.execute(
                insert(UserNotification).values(
                    user_id=user_id,
                    notification_type=NotificationType.INTERNAL_NOTE_MENTION,
                    title=f"{actor.name} te mencionó en una nota",
                    body=note["content"],
                    lead_id=note["lead_id"],
                    source_id=str(note["id"]),
                    metadata_={"note_id": note["id"], "author_user_id": actor.id, "author_name": actor.name},
                    read_at=None,
                    created_at=now,
                ).returning(UserNotification.id)
            )).scalar_one()
            created.append((user_id, notification_id))
        await session.commit()
        rows = (await session.execute(
            select(UserNotification).where(UserNotification.id.in_([item[1] for item in created]))
        )).scalars().all()
    by_id = {row.id: _notification(row) for row in rows}
    return [(user_id, by_id[notification_id]) for user_id, notification_id in created]


async def list_notifications(
    user_id: int,
    unread_only: bool = False,
    limit: int = 50,
    offset: int = 0,
) -> dict:
    stmt = select(UserNotification).where(UserNotification.user_id == user_id)
    if unread_only:
        stmt = stmt.where(UserNotification.read_at.is_(None))
    stmt = (
        stmt.order_by(UserNotification.created_at.desc(), UserNotification.id.desc())
        .offset(offset)
        .limit(limit + 1)
    )
    async with get_sessionmaker()() as session:
        rows = (await session.execute(stmt)).scalars().all()
        unread_count = await session.scalar(
            select(func.count(UserNotification.id)).where(
                UserNotification.user_id == user_id,
                UserNotification.read_at.is_(None),
            )
        )
    return {
        "items": [_notification(row) for row in rows[:limit]],
        "unread_count": int(unread_count or 0),
        "has_more": len(rows) > limit,
    }


async def mark_notification_read(notification_id: int, user_id: int) -> bool:
    async with get_sessionmaker()() as session:
        result = await session.execute(
            update(UserNotification)
            .where(UserNotification.id == notification_id, UserNotification.user_id == user_id)
            .values(read_at=func.coalesce(UserNotification.read_at, datetime.now(timezone.utc)))
        )
        await session.commit()
    return result.rowcount > 0


async def mark_all_notifications_read(user_id: int) -> int:
    async with get_sessionmaker()() as session:
        result = await session.execute(
            update(UserNotification)
            .where(UserNotification.user_id == user_id, UserNotification.read_at.is_(None))
            .values(read_at=datetime.now(timezone.utc))
        )
        await session.commit()
    return result.rowcount


async def mark_lead_notifications_read(lead_id: str, user_id: int) -> int:
    async with get_sessionmaker()() as session:
        result = await session.execute(
            update(UserNotification)
            .where(
                UserNotification.user_id == user_id,
                UserNotification.lead_id == lead_id,
                UserNotification.read_at.is_(None),
            )
            .values(read_at=datetime.now(timezone.utc))
        )
        await session.commit()
    return result.rowcount

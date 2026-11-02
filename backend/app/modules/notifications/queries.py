"""Lado de lectura de las notificaciones: la campanita del usuario."""

from __future__ import annotations

from sqlalchemy import func, select

from app.db.models.notifications import UserNotification
from app.db.uow import session_scope
from app.modules.notifications.policies import _notification


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
    async with session_scope() as session:
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

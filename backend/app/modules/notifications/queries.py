"""Lado de lectura de las notificaciones: la campanita del usuario."""

from __future__ import annotations

from sqlalchemy import func, select

from app.db.models.notifications import UserNotification
from app.db.uow import session_scope
from app.modules.notifications.policies import _notification
from app.modules.leads.ports.visibility import lead_ids_owned_by
from app.modules.appointments.ports.visibility import appointment_ids_visible_to
from app.modules.notifications.types import NotificationType


async def list_notifications(
    user_id: int,
    unread_only: bool = False,
    limit: int = 50,
    offset: int = 0,
    owner_id: int | None = None,
) -> dict:
    conditions = [UserNotification.user_id == user_id]
    if owner_id is not None:
        # Antes, las notificaciones de cita guardaban solo appointment_id.
        # Activar el ajuste también debe ocultar esos avisos históricos.
        appointment_id = UserNotification.metadata_["appointment_id"].as_integer()
        unlinked_visible = UserNotification.lead_id.is_(None) & (
            UserNotification.notification_type.not_in(
                (NotificationType.APPOINTMENT, NotificationType.APPOINTMENT_CHANGE)
            )
            | appointment_id.is_(None)
            | appointment_id.in_(appointment_ids_visible_to(owner_id))
        )
        conditions.append(unlinked_visible | UserNotification.lead_id.in_(lead_ids_owned_by(owner_id)))
    stmt = select(UserNotification).where(*conditions)
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
                *conditions,
                UserNotification.read_at.is_(None),
            )
        )
    return {
        "items": [_notification(row) for row in rows[:limit]],
        "unread_count": int(unread_count or 0),
        "has_more": len(rows) > limit,
    }

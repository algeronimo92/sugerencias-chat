"""Comandos de notificaciones. Cada uno corre en su unidad de trabajo; marcar
como leídas avisa a las otras pestañas del usuario con ``NotificationsRead``.
Las lecturas viven en queries.py."""

from __future__ import annotations

from app.db.uow import collect, unit_of_work
from app.modules.notifications import repository
from app.modules.notifications.events import NotificationsRead
from app.modules.notifications.types import NotificationType


async def create_system_notification(
    user_id: int,
    notification_type: NotificationType,
    title: str,
    body: str,
    lead_id: str | None = None,
    source_id: str | None = None,
    metadata: dict | None = None,
) -> dict:
    async with unit_of_work():
        return await repository.create_system_notification(
            user_id, notification_type, title, body, lead_id, source_id, metadata,
        )


async def create_mention_notifications(note: dict, user_ids: list[int], actor) -> list[tuple[int, dict]]:
    async with unit_of_work():
        return await repository.create_mention_notifications(note, user_ids, actor)


async def mark_notification_read(notification_id: int, user_id: int) -> bool:
    async with unit_of_work():
        marked = await repository.mark_notification_read(notification_id, user_id)
        if marked:
            collect(NotificationsRead(user_id=user_id))
    return marked


async def mark_all_notifications_read(user_id: int) -> int:
    async with unit_of_work():
        count = await repository.mark_all_notifications_read(user_id)
        collect(NotificationsRead(user_id=user_id))
    return count


async def mark_lead_notifications_read(lead_id: str, user_id: int) -> int:
    async with unit_of_work():
        return await repository.mark_lead_notifications_read(lead_id, user_id)

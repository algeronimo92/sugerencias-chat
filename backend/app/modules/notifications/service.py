from app.modules.notifications import repository
from app.modules.notifications.policies import (_notification)
from datetime import datetime, timezone


from domain_types import NotificationType
from app.db.models.notifications import UserNotification
from app.core.time_format import iso_utc


async def create_system_notification(user_id: int, notification_type: NotificationType, title: str, body: str, lead_id: str | None=None, source_id: str | None=None, metadata: dict | None=None) -> dict:
    return await repository.create_system_notification(user_id, notification_type, title, body, lead_id, source_id, metadata)


async def create_mention_notifications(note: dict, user_ids: list[int], actor) -> list[tuple[int, dict]]:
    return await repository.create_mention_notifications(note, user_ids, actor)


async def list_notifications(user_id: int, unread_only: bool=False, limit: int=50, offset: int=0) -> dict:
    return await repository.list_notifications(user_id, unread_only, limit, offset)


async def mark_notification_read(notification_id: int, user_id: int) -> bool:
    return await repository.mark_notification_read(notification_id, user_id)


async def mark_all_notifications_read(user_id: int) -> int:
    return await repository.mark_all_notifications_read(user_id)


async def mark_lead_notifications_read(lead_id: str, user_id: int) -> int:
    return await repository.mark_lead_notifications_read(lead_id, user_id)

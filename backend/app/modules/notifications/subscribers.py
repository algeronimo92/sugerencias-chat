"""Notificaciones que generan otros módulos, después del commit."""

from __future__ import annotations

import logging
from dataclasses import dataclass

from app.core.events import Phase, subscribe
from app.modules.conversations.public import NoteMentionsAdded, NoteMentionsRead
from app.modules.notifications.push_service import send_push_to_user
from app.modules.notifications.repository import create_mention_notifications, mark_lead_notifications_read
from app.realtime.ws_manager import manager

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class _Author:
    id: int
    name: str


@subscribe(NoteMentionsAdded, phase=Phase.AFTER_COMMIT)
async def notify_mentions(event: NoteMentionsAdded) -> None:
    created = await create_mention_notifications(
        event.note, list(event.user_ids), _Author(event.author_id, event.author_name),
    )
    for user_id, notification in created:
        await manager.send_to_user(user_id, {"type": "notification_created", "notification": notification})
        try:
            await send_push_to_user(
                user_id,
                notification["title"],
                notification["body"],
                f"/chat/{event.chat_id}",
                tag=f"note-mention-{event.note['id']}",
            )
        except Exception:
            # La notificación ya quedó guardada; un fallo del push no la deshace.
            logger.exception("No se pudo enviar push de mención a user %s", user_id)


@subscribe(NoteMentionsRead, phase=Phase.AFTER_COMMIT)
async def mark_lead_notifications_seen(event: NoteMentionsRead) -> None:
    changed = await mark_lead_notifications_read(event.chat_id, event.user_id)
    if changed or event.mentions_changed:
        await manager.send_to_user(event.user_id, {"type": "notifications_updated"})

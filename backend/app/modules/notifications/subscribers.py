"""Notificaciones que generan otros módulos, después del commit."""

from __future__ import annotations

import logging
from dataclasses import dataclass

from app.core.events import Phase, subscribe
from app.modules.appointments.public import AppointmentCreated
from app.modules.conversations.public import NoteMentionsAdded, NoteMentionsRead
from app.modules.issue_reports.ports.service import list_active_admin_ids
from app.modules.notifications.push_service import send_push_to_user
from app.modules.notifications.repository import create_mention_notifications, mark_lead_notifications_read
from app.modules.notifications.service import create_system_notification
from app.realtime.ws_manager import manager
from domain_types import NotificationType

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


@subscribe(AppointmentCreated, phase=Phase.AFTER_COMMIT)
async def notify_new_appointment(event: AppointmentCreated) -> None:
    """Quien cargó la cita y los admins se enteran, en la app y por push."""
    try:
        recipient_ids = {event.created_by_user_id, *(await list_active_admin_ids())}
        for recipient_id in recipient_ids:
            notification = await create_system_notification(
                recipient_id, NotificationType.APPOINTMENT, event.title, event.text,
                source_id=str(event.appointment_id), metadata={"appointment_id": event.appointment_id},
            )
            await manager.send_to_user(recipient_id, {"type": "notification_created", "notification": notification})
            await send_push_to_user(
                recipient_id, event.title, event.text, "/citas/nueva", tag=f"appointment-{event.appointment_id}",
            )
    except Exception:
        logger.exception("No se pudo avisar de la nueva cita %s", event.appointment_id)

"""Notificaciones que generan otros módulos, después del commit."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from dataclasses import dataclass

from app.core.events import Phase, subscribe
from app.modules.appointments.public import AppointmentCreated
from app.db.uow import collect
from app.modules.auth.ports.users import list_active_sellers
from app.modules.conversations.public import CallEnded, CallRinging, NoteMentionsAdded, NoteMentionsRead
from app.modules.issue_reports.ports.service import list_active_admin_ids
from app.modules.leads.ports.visibility import call_agents_for, lead_recipients
from app.modules.notifications.events import NotificationCreated, NotificationsRead
from app.modules.notifications.push_service import send_push_to_user
from app.modules.notifications.service import (
    create_mention_notifications,
    create_system_notification,
    mark_lead_notifications_read,
)
from app.realtime.ws_manager import manager
from app.tenancy.context import get_current_tenant
from app.modules.notifications.types import NotificationType

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class _Author:
    id: int
    name: str


@subscribe(NoteMentionsAdded, phase=Phase.AFTER_COMMIT)
async def notify_mentions(event: NoteMentionsAdded) -> None:
    created = await create_mention_notifications(
        event.note, sorted(await lead_recipients(event.chat_id, event.user_ids)), _Author(event.author_id, event.author_name),
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
    """Quien cargó la cita, el responsable elegido y los admins se enteran,
    en la app y por push. El responsable se guarda por nombre (el formulario
    ofrece los nombres del equipo): antes solo se avisaba a quien la cargó,
    y una cita agendada por recepción para otra vendedora no le llegaba a ella."""
    try:
        recipient_ids = {
            event.created_by_user_id,
            *(await list_active_admin_ids()),
            *(await _seller_ids(event.seller_name)),
        }
        if event.lead_id is not None:
            recipient_ids = await lead_recipients(event.lead_id, recipient_ids)
        for recipient_id in recipient_ids:
            notification = await create_system_notification(
                recipient_id, NotificationType.APPOINTMENT, event.title, event.text,
                source_id=str(event.appointment_id), metadata={"appointment_id": event.appointment_id}, lead_id=event.lead_id,
            )
            await manager.send_to_user(recipient_id, {"type": "notification_created", "notification": notification})
            await send_push_to_user(
                recipient_id, event.title, event.text, "/citas/nueva", tag=f"appointment-{event.appointment_id}",
            )
    except Exception:
        logger.exception("No se pudo avisar de la nueva cita %s", event.appointment_id)


async def _seller_ids(name: str) -> list[int]:
    wanted = name.strip().casefold()
    if not wanted:
        return []
    return [seller["id"] for seller in await list_active_sellers() if seller["name"].strip().casefold() == wanted]


@subscribe(NotificationsRead, phase=Phase.AFTER_COMMIT)
async def refresh_the_bell(event: NotificationsRead) -> None:
    await manager.send_to_user(event.user_id, {"type": "notifications_updated"})


@subscribe(NotificationCreated, phase=Phase.AFTER_COMMIT)
async def deliver_notification(event: NotificationCreated) -> None:
    lead_id = event.notification.get("lead_id")
    if lead_id and event.user_id not in await lead_recipients(lead_id, [event.user_id]):
        return
    await manager.send_to_user(event.user_id, {"type": "notification_created", "notification": event.notification})
    try:
        await send_push_to_user(event.user_id, event.push_title, event.push_body, event.push_url, tag=event.push_tag)
    except Exception:
        # La notificación ya quedó guardada; un fallo del push no la deshace.
        logger.exception("No se pudo enviar push de la notificación a user %s", event.user_id)


def _caller(name: str | None) -> str:
    return f"De {name}" if name else "De un cliente"


@subscribe(CallEnded, phase=Phase.TRANSACTION)
async def record_missed_call(event: CallEnded) -> None:
    """La llamada perdida queda en la campanita de quienes atienden. Va en la
    misma transacción que cierra la llamada: lo que corre después del commit
    se ejecuta una sola vez, y si el proceso muere ahí el aviso no existiría
    nunca. El timbre por push y el WebSocket sí pueden perderse; esto no."""
    if event.status != "missed":
        return
    for agent in await call_agents_for(event.chat_id):
        notification = await create_system_notification(
            agent["id"], NotificationType.MISSED_CALL, "Llamada perdida", _caller(event.caller_name),
            lead_id=event.chat_id, source_id=str(event.call_id),
            metadata={"call_id": event.call_id, "cause": event.cause},
        )
        collect(NotificationCreated(
            user_id=agent["id"], notification=notification, push_title="Llamada perdida",
            push_body=_caller(event.caller_name), push_url=f"/chat/{event.chat_id}",
            # El mismo tag que el timbre: en el celular lo reemplaza en vez de apilarse.
            push_tag=f"call-{event.call_id}",
        ))


# Los push del timbre salen sin esperar: se mandan de a uno y cada envío puede
# tardar, y este handler corre dentro del carril de llamadas del webhook. Se
# guarda la referencia para que el recolector no cancele la tarea a medias.
_ring_pushes: set[asyncio.Task] = set()
# Meta da entre 30 y 60 s para atender.
RING_PUSH_TTL_SECONDS = 45


async def _push_ring(user_ids: list[int], body: str, chat_id: str, call_id: int) -> None:
    for user_id in user_ids:
        if user_id not in await lead_recipients(chat_id, [user_id]):
            continue
        try:
            await send_push_to_user(
                user_id, "Llamada entrante", body, f"/chat/{chat_id}", tag=f"call-{call_id}", kind="incoming_call",
                # Pasado ese tiempo la llamada ya terminó: un timbre que llega
                # tarde solo confunde. Y no puede esperar a que el teléfono cargue.
                ttl_seconds=RING_PUSH_TTL_SECONDS, urgency="high",
            )
        except Exception:
            logger.exception("No se pudo enviar el push de llamada entrante a user %s", user_id)


@subscribe(CallRinging, phase=Phase.AFTER_COMMIT)
async def push_incoming_call(event: CallRinging) -> None:
    """Para quien tiene el CRM cerrado o en segundo plano: con la app a la
    vista ya suena por el WebSocket y el service worker no muestra el push."""
    user_ids = [agent["id"] for agent in await call_agents_for(event.chat_id)]
    task = asyncio.create_task(_push_ring(user_ids, _caller(event.caller_name), event.chat_id, event.call_id))
    _ring_pushes.add(task)
    task.add_done_callback(_ring_pushes.discard)


# Un aviso por día y por negocio: cada llamada que falle con la cuenta pausada
# repetiría el mismo mensaje. Es memoria del proceso; tras un reinicio puede
# avisar una vez más, que es preferible a no avisar.
_paused_notified: dict[str | None, str] = {}


@subscribe(CallEnded, phase=Phase.AFTER_COMMIT)
async def warn_admins_calls_are_paused(event: CallEnded) -> None:
    """No puede esperar a que alguien abra el dashboard: mientras dure la
    pausa, ninguna llamada entra ni sale."""
    if event.cause != "account_paused":
        return
    context = get_current_tenant()
    key = str(context.organization_id) if context else None
    today = datetime.now(timezone.utc).date().isoformat()
    if _paused_notified.get(key) == today:
        return
    _paused_notified[key] = today
    title = "Meta pausó las llamadas de WhatsApp"
    body = "El número no puede recibir ni hacer llamadas. Revisa el motivo en WhatsApp Manager."
    for admin_id in await list_active_admin_ids():
        try:
            notification = await create_system_notification(
                admin_id, NotificationType.CALLS_PAUSED, title, body, source_id=f"calls-paused:{today}",
            )
            await manager.send_to_user(admin_id, {"type": "notification_created", "notification": notification})
            await send_push_to_user(admin_id, title, body, "/integraciones#whatsapp", tag="calls-paused")
        except Exception:
            logger.exception("No se pudo avisar a la admin %s de la pausa de llamadas", admin_id)


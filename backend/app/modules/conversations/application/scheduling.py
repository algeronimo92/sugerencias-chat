"""Casos de uso de los mensajes programados."""

from __future__ import annotations

from datetime import datetime, timezone

from app.core.errors import NotFound
from app.db.uow import collect, unit_of_work
from app.modules.conversations.application.outbound import queue_text
from app.modules.conversations.application.ports import conversation_ports
from app.modules.conversations.domain.events import ScheduledMessageChanged
from app.modules.conversations.domain.scheduling import ensure_can_cancel, normalized_send_time
from app.modules.conversations.domain.service_window import SERVICE_WINDOW_CLOSED_DETAIL, window_is_open
from domain_types import ScheduledMessageStatus


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def schedule_message(lead_id: str, text: str, scheduled_at: datetime, user_id: int) -> dict:
    send_at = normalized_send_time(scheduled_at, _now())
    async with unit_of_work():
        item = await conversation_ports().scheduled.create(lead_id, text, send_at, user_id)
        if item is None:
            raise NotFound("Lead no encontrado")
        collect(ScheduledMessageChanged(chat_id=lead_id, status=ScheduledMessageStatus.SCHEDULED))
    return item


async def cancel_scheduled_message(scheduled_id: int, user_id: int, is_admin: bool) -> dict:
    store = conversation_ports().scheduled
    async with unit_of_work():
        scheduled = await store.lock(scheduled_id)
        if scheduled is None:
            raise NotFound("Mensaje programado no encontrado")
        ensure_can_cancel(
            status=scheduled["status"], created_by_user_id=scheduled["created_by_user_id"],
            user_id=user_id, is_admin=is_admin,
        )
        await store.cancel(scheduled_id, _now())
        collect(ScheduledMessageChanged(chat_id=scheduled["lead_id"], status=ScheduledMessageStatus.CANCELLED))
    return {"id": scheduled_id, "lead_id": scheduled["lead_id"], "status": ScheduledMessageStatus.CANCELLED}


async def dispatch_scheduled_message(scheduled_id: int) -> None:
    """Encola un programado que llegó a su hora, en una sola transacción.

    Con la ventana de 24 h cerrada no se encola: queda fallido con el motivo.
    La clave de idempotencia sale de la fila, así un reintento devuelve el
    mismo mensaje en vez de crear otro.
    """
    ports = conversation_ports()
    async with unit_of_work():
        scheduled = await ports.scheduled.lock_for_dispatch(scheduled_id)
        if scheduled is None:
            return
        lead_id = scheduled["lead_id"]
        if not window_is_open(await ports.service_window(lead_id)):
            await ports.scheduled.fail(scheduled_id, SERVICE_WINDOW_CLOSED_DETAIL, _now())
            collect(ScheduledMessageChanged(chat_id=lead_id, status=ScheduledMessageStatus.FAILED))
            return
        # Sin actor: nadie está mirando la app cuando sale, así que cuenta como
        # "atendido por bot". El mensaje sí es obra de quien lo programó.
        message = await queue_text(
            lead_id, scheduled["text"],
            author_user_id=scheduled["created_by_user_id"],
            dedupe_key=f"scheduled:{scheduled_id}",
        )
        await ports.scheduled.mark_queued(scheduled_id, message["id"], _now())
        collect(ScheduledMessageChanged(chat_id=lead_id, status=ScheduledMessageStatus.QUEUED))

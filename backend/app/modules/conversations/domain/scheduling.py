"""Reglas de los mensajes programados."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.core.errors import Conflict, Forbidden, Invalid
from app.modules.conversations.domain.types import ScheduledMessageStatus

# Margen para que "programar para ya" no termine saliendo antes de guardarse.
MIN_LEAD_TIME = timedelta(seconds=5)

CANCELLABLE = (ScheduledMessageStatus.SCHEDULED, ScheduledMessageStatus.FAILED)


class ScheduleInThePast(Invalid):
    status_code = 400
    code = "schedule_in_the_past"

    def __init__(self) -> None:
        super().__init__("Elige una hora futura para programar el mensaje")


class CannotCancelOthersMessage(Forbidden):
    code = "cannot_cancel_others_scheduled_message"

    def __init__(self) -> None:
        super().__init__("No puedes cancelar un mensaje programado por otro usuario")


class AlreadyDispatching(Conflict):
    code = "scheduled_message_in_progress"

    def __init__(self) -> None:
        super().__init__("El mensaje ya está en proceso de envío y no puede cancelarse")


def normalized_send_time(scheduled_at: datetime, now: datetime) -> datetime:
    """La hora en UTC, validada como futura."""
    if scheduled_at.tzinfo is None:
        scheduled_at = scheduled_at.replace(tzinfo=timezone.utc)
    scheduled_at = scheduled_at.astimezone(timezone.utc)
    if scheduled_at <= now + MIN_LEAD_TIME:
        raise ScheduleInThePast()
    return scheduled_at


def ensure_can_cancel(*, status: str, created_by_user_id: int, user_id: int, is_admin: bool) -> None:
    if not is_admin and created_by_user_id != user_id:
        raise CannotCancelOthersMessage()
    if status not in CANCELLABLE:
        raise AlreadyDispatching()

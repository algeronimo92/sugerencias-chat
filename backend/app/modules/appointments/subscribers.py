"""Reacciones de ``appointments`` a sus propios eventos, después del commit."""

from __future__ import annotations

import logging

from app.core.events import Phase, subscribe
from app.modules.appointments.application.notice import send_client_notice, send_staff_notice
from app.modules.appointments.domain.events import AppointmentCreated

logger = logging.getLogger(__name__)


@subscribe(AppointmentCreated, phase=Phase.AFTER_COMMIT)
async def notify_the_client(event: AppointmentCreated) -> None:
    """La cita ya está guardada: un aviso que falla no la deshace."""
    try:
        outcome = await send_client_notice(event.appointment_id)
    except Exception:
        logger.exception("No se pudo avisar al cliente de la cita %s", event.appointment_id)
        return
    logger.info("Aviso al cliente de la cita %s: %s", event.appointment_id, outcome)


@subscribe(AppointmentCreated, phase=Phase.AFTER_COMMIT)
async def notify_the_team(event: AppointmentCreated) -> None:
    try:
        outcome = await send_staff_notice(event.appointment_id)
    except Exception:
        logger.exception("No se pudo avisar al equipo de la cita %s", event.appointment_id)
        return
    logger.info("Aviso al equipo de la cita %s: %s", event.appointment_id, outcome)

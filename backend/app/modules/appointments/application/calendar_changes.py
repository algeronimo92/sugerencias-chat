"""Las citas que se cambiaron a mano en Google Calendar: cómo se detectan,
a quién se avisa y cómo se confirma el cambio.

El equipo reprograma o cambia el tratamiento editando el evento (el CRM no
edita citas) y la cita se quedaba con los datos viejos: los recordatorios
salían con el tratamiento de antes. Ahora el worker de recordatorios compara
cada evento con su cita; si el título ya no es el que arma el CRM, anota el
cambio, avisa al equipo y retiene los recordatorios de esa cita hasta que
alguien confirma el servicio que tiene de verdad.
"""

from __future__ import annotations

import logging
from datetime import date, datetime

from app.db.uow import collect, unit_of_work
from app.modules.appointments.application.calendar_template import title_renderer
from app.modules.appointments.application.ports import appointment_ports
from app.modules.appointments.domain.calendar_change import suggested_treatment, title_changed
from app.modules.appointments.domain.errors import AppointmentNotFound, NoCalendarChangePending
from app.modules.appointments.domain.events import AppointmentCalendarChanged
from app.modules.appointments.domain.reminders import CalendarEvent
from app.modules.platform.public import business_timezone

logger = logging.getLogger(__name__)

PENDING_REASON = "La cita se cambió en el calendario: confirma el cambio en el CRM"


def scheduled(appointment: dict, event: CalendarEvent) -> dict:
    """La cita con la fecha, hora y duración que tiene hoy en el calendario:
    si se movió allá, el recordatorio dice la hora nueva."""
    return {
        **appointment,
        "fecha": event.starts_at.date().isoformat(),
        "hora": event.starts_at.strftime("%H:%M"),
        "duration_minutes": event.duration_minutes or appointment.get("duration_minutes") or 0,
    }


def _announcement(appointment: dict, summary: str) -> tuple[str, str]:
    name = appointment.get("nombre_completo") or "Una cita"
    title = "Cita cambiada en el calendario"
    text = (
        f"{name}: en el CRM es «{appointment.get('tratamiento') or 'sin servicio'}» y en el calendario "
        f"«{summary}». Confírmalo para que salgan sus recordatorios."
    )
    return title, text


async def review_calendar_changes(events: list[CalendarEvent], now: datetime) -> set[int]:
    """Compara cada evento creado desde el CRM con su cita y devuelve los
    ids de las citas con un cambio sin confirmar. Un cambio nuevo se anota
    y se avisa una sola vez; si el evento vuelve a decir lo del CRM, el
    pendiente se olvida."""
    ids = {event.appointment_id for event in events if event.appointment_id is not None}
    if not ids:
        return set()
    ports = appointment_ports()
    appointments = await ports.repository.get_many(ids)
    _template, render_title = await title_renderer()
    pending: set[int] = set()
    for event in events:
        appointment = appointments.get(event.appointment_id) if event.appointment_id is not None else None
        if appointment is None or appointment.get("test_mode") or appointment.get("dismissed_at"):
            continue
        changed = title_changed(
            event.summary, render_title(scheduled(appointment, event)), appointment.get("calendar_confirmed_summary"),
        )
        if not changed:
            if appointment.get("calendar_change") is not None:
                await ports.repository.clear_calendar_change(appointment["id"])
            continue
        pending.add(appointment["id"])
        async with unit_of_work():
            is_new = await ports.repository.flag_calendar_change(
                appointment["id"], summary=event.summary, starts_at=event.starts_at, at=now,
            )
            if is_new:
                title, text = _announcement(appointment, event.summary)
                collect(AppointmentCalendarChanged(
                    appointment_id=appointment["id"], created_by_user_id=appointment["created_by_user_id"],
                    seller_name=appointment.get("vendedor") or "", title=title, text=text,
                    lead_id=appointment.get("lead_id"),
                ))
        if is_new:
            logger.info("La cita %s se cambió en el calendario: «%s»", appointment["id"], event.summary)
    return pending


async def with_suggestion(appointment: dict) -> dict:
    """La cita con el servicio que se lee del título del calendario, para
    proponerlo al confirmar."""
    change = appointment.get("calendar_change")
    if change is None:
        return appointment
    template, _render = await title_renderer()
    return {
        **appointment,
        "calendar_change": {**change, "suggested_treatment": suggested_treatment(change["summary"], template)},
    }


def _local_start(starts_at: str | None, tz) -> tuple[date | None, str | None]:
    if not starts_at:
        return None, None
    local = datetime.fromisoformat(starts_at.replace("Z", "+00:00")).astimezone(tz)
    return local.date(), local.strftime("%H:%M")


async def get_with_change(appointment_id: int) -> dict:
    appointment = await appointment_ports().repository.get(appointment_id)
    if appointment is None:
        raise AppointmentNotFound()
    return await with_suggestion(appointment)


async def confirm_calendar_change(appointment_id: int, *, tratamiento: str) -> dict:
    """Deja la cita como dice el calendario: el servicio que confirma el
    equipo y la fecha y hora del evento. Levanta ``NoCalendarChangePending``
    si no había nada por confirmar."""
    ports = appointment_ports()
    appointment = await ports.repository.get(appointment_id)
    if appointment is None:
        raise AppointmentNotFound()
    change = appointment.get("calendar_change")
    if change is None:
        raise NoCalendarChangePending()
    fecha, hora = _local_start(change.get("starts_at"), await business_timezone())
    updated = await ports.repository.confirm_calendar_change(
        appointment_id, tratamiento=" ".join(tratamiento.split()), fecha=fecha, hora=hora,
    )
    if updated is None:
        raise NoCalendarChangePending()
    return updated

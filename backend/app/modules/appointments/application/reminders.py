"""Los recordatorios de cita por WhatsApp: cómo los configura el negocio y
cómo salen.

Cada minuto el worker lee de Google Calendar los eventos de los próximos
días y manda los recordatorios que tocan (un día, cinco horas, una hora
antes, o lo que configure el negocio), siempre desde el número de avisos y
directo al WhatsApp del paciente: no entran al chat del CRM.

Se lee el calendario y no la tabla de citas porque ahí es donde el equipo
mueve y cancela: la cita que se movió avisa a la hora nueva y la que se borró
no avisa. Un evento creado desde el CRM trae el id de su cita; uno cargado a
mano solo avisa si su texto trae un teléfono y el negocio lo permitió.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from app.core.phone_utils import PhoneValidationError, normalize_phone
from app.modules.appointments.application.commands import match_phone
from app.modules.appointments.application.notice import (
    REMINDERS_HOURS_KEY,
    REMINDERS_KEY,
    REMINDERS_MANUAL_KEY,
    _fields,
    _preview,
    _sendable,
    _sender,
    _short,
    _template,
    _variable_count,
    template_choices,
)
from app.modules.appointments.application.ports import appointment_ports
from app.modules.appointments.domain.errors import CalendarUnavailable
from app.modules.appointments.domain.notice import Audience, InvalidNotice, as_template, parameter_values, validate_parameters
from app.modules.appointments.domain.reminders import (
    REMINDER_FIELDS,
    REMINDER_SAMPLES,
    CalendarEvent,
    Reminder,
    ReminderHours,
    due_reminders,
    dump_reminders,
    extract_phone,
    parse_hours,
    parse_reminders,
    reminder_values,
    validate_hours,
    validate_offsets,
)
from app.modules.catalogs.ports.template_service import list_templates
from app.modules.platform.ports.settings_service import get_effective_many, update_settings
from app.modules.platform.public import effective_country_code

logger = logging.getLogger(__name__)

RECENT_LIMIT = 20
_CALENDAR_KEYS = ("google_calendar_enabled", "google_calendar_id", "google_calendar_refresh_token")
# Quien pide la lista de plantillas solo cambia cuáles personales ve; un
# recordatorio solo usa globales, así que el worker no necesita un usuario.
_NO_USER = 0


async def _stored() -> tuple[tuple[Reminder, ...], bool, ReminderHours | None]:
    stored = await get_effective_many((REMINDERS_KEY, REMINDERS_MANUAL_KEY, REMINDERS_HOURS_KEY))
    return (
        parse_reminders(stored[REMINDERS_KEY] or ""),
        stored[REMINDERS_MANUAL_KEY] == "true",
        parse_hours(stored[REMINDERS_HOURS_KEY] or ""),
    )


async def _calendar_ready() -> bool:
    stored = await get_effective_many(_CALENDAR_KEYS)
    return stored["google_calendar_enabled"].lower() in {"true", "1", "yes", "on"} and all(
        stored[key] for key in _CALENDAR_KEYS[1:]
    )


async def _reminder_fields() -> list[dict]:
    """Los campos de los avisos más los que solo tiene un recordatorio."""
    return [
        {"key": key, "label": label, "group": "recordatorio"} for key, label in REMINDER_FIELDS.items()
    ] + await _fields()


async def _reminder_preview() -> dict | None:
    preview = await _preview()
    return None if preview is None else {**preview, "values": {**preview["values"], **REMINDER_SAMPLES}}


async def get_settings(user_id: int) -> dict:
    reminders, manual, hours = await _stored()
    return {
        "include_manual_events": manual,
        "hours": None if hours is None else {"start": f"{hours.start:%H:%M}", "end": f"{hours.end:%H:%M}"},
        "reminders": [
            {
                "offset_minutes": item.offset_minutes, "enabled": item.enabled, "template_id": item.template_id,
                "parameters": [as_template(value) for value in item.parameters],
            }
            for item in reminders
        ],
        "fields": await _reminder_fields(),
        "templates": await template_choices(Audience.CLIENT, user_id),
        "preview": await _reminder_preview(),
        "calendar_ready": await _calendar_ready(),
        "sender_ready": await _sender() is not None,
        "recent": await appointment_ports().reminders.recent(RECENT_LIMIT),
    }


async def save_settings(
    *, include_manual_events: bool, reminders: list[dict], user_id: int, hours: dict | None = None,
) -> dict:
    """Guarda la lista de recordatorios. Uno apagado y sin plantilla se puede
    guardar; con plantilla, exige que sea enviable y que cada variable tenga
    contenido con campos que existan. Levanta ``InvalidNotice`` si no."""
    items = [
        Reminder(
            offset_minutes=item["offset_minutes"], enabled=item["enabled"],
            template_id=item.get("template_id"), parameters=tuple(item.get("parameters") or ()),
        )
        for item in reminders
    ]
    validate_offsets(items)
    window = validate_hours(hours["start"], hours["end"]) if hours is not None else None
    known_keys = {item["key"] for item in await _reminder_fields()}
    clean: list[Reminder] = []
    for item in sorted(items, key=lambda reminder: -reminder.offset_minutes):
        if item.template_id is None and not item.enabled:
            clean.append(Reminder(offset_minutes=item.offset_minutes))
            continue
        template = await _template(item.template_id, user_id, Audience.CLIENT)
        if template is None:
            raise InvalidNotice("Elige una plantilla oficial aprobada y visible para todo el equipo")
        parameters = validate_parameters(
            list(item.parameters), expected=_variable_count(template), known_keys=known_keys,
        )
        clean.append(Reminder(item.offset_minutes, item.enabled, item.template_id, parameters))
    await update_settings({
        REMINDERS_KEY: dump_reminders(tuple(clean)),
        REMINDERS_MANUAL_KEY: "true" if include_manual_events else "",
        REMINDERS_HOURS_KEY: window.to_setting() if window is not None else "",
    })
    return await get_settings(user_id)


async def send_due_reminders(now: datetime | None = None) -> dict[str, int]:
    """Una pasada del worker: manda los recordatorios que tocan ahora y
    devuelve cuántos terminaron en cada estado. Sin recordatorios activos,
    sin número de avisos o sin calendario no hace nada."""
    reminders, manual, hours = await _stored()
    active = tuple(item for item in reminders if item.enabled and item.template_id is not None)
    if not active:
        return {}
    sender = await _sender()
    if sender is None:
        return {}
    now = now or datetime.now(timezone.utc)
    horizon = max(item.offset for item in active) + timedelta(minutes=1)
    ports = appointment_ports()
    try:
        events = await ports.calendar.upcoming_events(now, now + horizon)
    except CalendarUnavailable as exc:
        logger.warning("No se leyeron los eventos para los recordatorios de cita: %s", exc)
        return {}
    if not events:
        return {}
    templates = {
        item["id"]: item for item in await list_templates(_NO_USER) if _sendable(item, Audience.CLIENT, sender)
    }
    outcome: dict[str, int] = {}
    for event in events:
        if event.starts_at <= now or (event.appointment_id is None and not manual):
            continue
        if hours is not None and not hours.covers(event.starts_at):
            # Fuera del horario elegido: se omite sin dejar registro, como un
            # evento que no es cita.
            continue
        due = due_reminders(active, event, now)
        if not due:
            continue
        target = await _target(event)
        if target is None:
            continue
        for reminder in due:
            reminder_id = await ports.reminders.claim(event, reminder.offset_minutes)
            if reminder_id is None:
                continue
            extra = reminder_values(reminder, event.starts_at, now)
            result = await _attempt(reminder, target, templates.get(reminder.template_id), sender, extra)
            await ports.reminders.finish(reminder_id, result)
            outcome[result["status"]] = outcome.get(result["status"], 0) + 1
    if outcome:
        logger.info("Recordatorios de cita: %s", outcome)
    return outcome


def _scheduled(appointment: dict, event: CalendarEvent) -> dict:
    """La cita con la fecha, hora y duración que tiene hoy en el calendario:
    si se movió allá, el recordatorio dice la hora nueva."""
    return {
        **appointment,
        "fecha": event.starts_at.date().isoformat(),
        "hora": event.starts_at.strftime("%H:%M"),
        "duration_minutes": event.duration_minutes or appointment.get("duration_minutes") or 0,
    }


async def _target(event: CalendarEvent) -> dict | None:
    """A quién y con qué datos va el recordatorio del evento: ``{appointment,
    lead_id, lead, phone, skip}``. ``None`` si el evento no debe avisar (una
    cita de prueba o desestimada)."""
    ports = appointment_ports()
    appointment = await ports.repository.get(event.appointment_id) if event.appointment_id else None
    if appointment is not None:
        if appointment.get("test_mode") or appointment.get("dismissed_at"):
            return None
        lead_id = appointment.get("lead_id")
        phone = None
        if not lead_id:
            try:
                phone = normalize_phone(appointment.get("telefono") or "", await effective_country_code())
            except PhoneValidationError:
                return {"appointment": _scheduled(appointment, event), "skip": "La cita no tiene un teléfono válido"}
        lead = await ports.leads.snapshot(lead_id) if lead_id else None
        return {"appointment": _scheduled(appointment, event), "lead_id": lead_id, "lead": lead, "phone": phone}
    # Un evento cargado a mano (o cuya cita ya no existe en el CRM): solo con
    # el teléfono escrito en el evento.
    raw = extract_phone(event.description, event.location, event.summary)
    base = {
        "nombre_completo": "", "telefono": raw or "", "tratamiento": event.summary, "detalle": "",
        "dni": "", "vendedor": "", "adelanto": 0, "custom_fields": {},
    }
    if raw is None:
        return {"appointment": _scheduled(base, event), "skip": "El evento no trae un teléfono"}
    match = await match_phone(raw)
    if match.e164 is None:
        return {"appointment": _scheduled(base, event), "skip": f"El teléfono {raw} no es válido"}
    lead = await ports.leads.snapshot(match.lead_id) if match.lead_id else None
    name = str((lead or {}).get("nombre") or "").strip()
    appointment = _scheduled({**base, "telefono": match.e164, "nombre_completo": name}, event)
    return {"appointment": appointment, "lead_id": match.lead_id, "lead": lead, "phone": match.e164}


async def _attempt(
    reminder: Reminder, target: dict, template: dict | None, sender: str, extra: dict[str, str],
) -> dict:
    """Manda un recordatorio y devuelve cómo salió. Nunca levanta."""
    appointment = target["appointment"]
    lead = target.get("lead") or {}
    result = {
        "recipient_name": appointment.get("nombre_completo") or str(lead.get("nombre") or "") or "Paciente",
        "phone": target.get("phone") or appointment.get("telefono") or None,
        "template_id": reminder.template_id,
    }
    if target.get("skip"):
        return {**result, "status": "skipped", "reason": target["skip"]}
    if template is None:
        return {**result, "status": "failed", "reason": "La plantilla ya no es una plantilla oficial aprobada y global"}
    parameters = parameter_values(appointment, reminder.parameters, target.get("lead"), extra)
    messenger = appointment_ports().messenger
    try:
        if target.get("lead_id"):
            provider_id = await messenger.send_to_lead_from(
                chat_id=target["lead_id"], template=template, parameters=parameters, sender=sender,
            )
        else:
            provider_id = await messenger.send_to_phone(
                phone=target["phone"], template=template, parameters=parameters, sender=sender,
            )
    except Exception as exc:
        # Cualquier error: el recordatorio queda como fallido con su motivo y
        # el resto de la pasada sigue.
        logger.warning("No se pudo mandar el recordatorio de %s", appointment.get("tratamiento"), exc_info=True)
        return {**result, "status": "failed", "reason": _short(exc)}
    return {**result, "status": "sent", "provider_message_id": provider_id}

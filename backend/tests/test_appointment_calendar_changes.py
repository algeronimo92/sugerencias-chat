"""Una cita cambiada a mano en Google Calendar: el CRM avisa, retiene sus
recordatorios y, cuando el equipo confirma, la cita queda como dice el
calendario.

El caso real (2026-11-27): una paciente tenía en el CRM "HIFU 12D" el 19/11; el
equipo cambió el evento a "BOTOX FULL FACE (x 850 soles)" y lo movió al 27, y
le llegaron tres recordatorios de HIFU 12D."""

from datetime import datetime
from unittest.mock import AsyncMock
from zoneinfo import ZoneInfo

import pytest

from app.modules.appointments.application import calendar_changes, calendar_template, commands, notice, reminders
from app.modules.appointments.domain.calendar_change import suggested_treatment, title_changed
from app.modules.appointments.domain.errors import NoCalendarChangePending
from app.modules.appointments.domain.events import AppointmentCalendarChanged
from app.modules.appointments.domain.reminders import CalendarEvent
from tests.appointment_fakes import in_memory_appointments  # noqa: F401

LIMA = ZoneInfo("America/Lima")
TITLE = "{tratamiento} - {dni} - {nombre_completo} - {vendedor}"
REMINDER = {
    "id": 21, "name": "recordatorio_cita", "content": "Hola {{1}}, tu {{2}} es el {{3}}",
    "template_type": "official", "official_status": "APPROVED", "visibility": "global", "is_active": True,
    "official_header_type": None, "official_name": "recordatorio_cita", "official_language": "es",
    "meta_template_id": "META_21", "official_parameter_values": ["Ana", "HIFU", "JUEVES 1 de Enero"],
}
FIELDS = ["{nombre_completo}", "{tratamiento}", "{fecha_larga}"]


def _at(day: int, hour: int, minute: int = 0) -> datetime:
    return datetime(2026, 12, day, hour, minute, tzinfo=LIMA)


@pytest.fixture
def stored(monkeypatch, in_memory_appointments):
    values: dict[str, str] = {
        "appointment_notice_phone_number_id": "AVISOS_ID", "google_calendar_title_template": TITLE,
    }

    async def update(new_values):
        values.update(new_values)

    def read(keys):
        return {key: values.get(key, "") for key in keys}

    for module in (notice, reminders, calendar_template):
        monkeypatch.setattr(module, "get_effective_many", AsyncMock(side_effect=read))
    for module in (notice, reminders):
        monkeypatch.setattr(module, "list_templates", AsyncMock(return_value=[REMINDER]))
        monkeypatch.setattr(module, "update_settings", AsyncMock(side_effect=update))
    for module in (notice, calendar_template):
        monkeypatch.setattr(module, "list_definitions", AsyncMock(return_value=[]))
    for module in (commands, reminders):
        monkeypatch.setattr(module, "effective_country_code", AsyncMock(return_value="51"))
    monkeypatch.setattr(calendar_changes, "business_timezone", AsyncMock(return_value=LIMA))
    return values


async def _setup(world, stored):
    await reminders.save_settings(
        include_manual_events=False, hours=None, user_id=1,
        reminders=[
            {"offset_minutes": offset, "enabled": True, "template_id": 21, "parameters": FIELDS}
            for offset in (1440, 180, 60)
        ],
    )
    row = await world.repository.add({
        "created_by_user_id": 7, "lead_id": "lead-1", "nombre_completo": "Ana Pérez Torres",
        "telefono": "987654321", "tratamiento": "HIFU 12D", "fecha": "2026-11-19", "hora": "16:00",
        "duration_minutes": 60, "dni": "45678912", "detalle": "", "vendedor": "Rosa Vendedora", "adelanto": 0,
        "custom_fields": {}, "test_mode": False, "status": "created",
    })
    return row["id"]


def _event(appointment_id: int, summary: str) -> CalendarEvent:
    return CalendarEvent(
        id="evt-ana", starts_at=_at(10, 16), ends_at=_at(10, 17), summary=summary,
        created_at=_at(1, 9), appointment_id=appointment_id,
    )


CHANGED = "BOTOX FULL FACE (x 850 soles) - Ana Pérez Torres - Rosa Vendedora"


# --- Reglas -----------------------------------------------------------------


def test_only_a_different_title_counts_as_a_change():
    crm = "HIFU 12D - 45678912 - Ana Pérez Torres - Rosa Vendedora"
    assert not title_changed(crm, crm)
    # Espacios y mayúsculas de más no son un cambio.
    assert not title_changed("hifu 12d  -  45678912 - ana pérez torres - rosa vendedora", crm)
    assert not title_changed("", crm)
    assert title_changed(CHANGED, crm)
    # El título que el equipo ya confirmó no vuelve a pedir confirmación.
    assert not title_changed(CHANGED, crm, confirmed_summary=CHANGED)


def test_the_service_is_read_from_the_calendar_title_without_the_price():
    assert suggested_treatment(CHANGED, TITLE) == "BOTOX FULL FACE"
    assert suggested_treatment("HIFU 12D (x360 soles)- 12345678 - Luz", TITLE) == "HIFU 12D"
    # Una plantilla que no empieza por el servicio no permite leerlo.
    assert suggested_treatment(CHANGED, "{nombre_completo} - {tratamiento}") == ""


# --- Detección y retención --------------------------------------------------


async def test_a_changed_appointment_warns_once_and_holds_its_reminders(stored, in_memory_appointments):
    world = in_memory_appointments
    appointment_id = await _setup(world, stored)
    world.calendar.events = [_event(appointment_id, CHANGED)]

    assert await reminders.send_due_reminders(_at(9, 16)) == {"skipped": 1}
    [row] = world.reminders.rows
    assert row["reason"] == calendar_changes.PENDING_REASON
    assert world.messenger.from_sender == []
    [event] = [item for item in world.published if isinstance(item, AppointmentCalendarChanged)]
    assert (event.appointment_id, event.created_by_user_id, event.seller_name, event.lead_id) == (
        appointment_id, 7, "Rosa Vendedora", "lead-1",
    )
    assert "HIFU 12D" in event.text and CHANGED in event.text

    # La pasada siguiente no vuelve a avisar.
    await reminders.send_due_reminders(_at(9, 16, 1))
    assert len([item for item in world.published if isinstance(item, AppointmentCalendarChanged)]) == 1

    appointment = await calendar_changes.get_with_change(appointment_id)
    assert appointment["calendar_change"]["summary"] == CHANGED
    assert appointment["calendar_change"]["suggested_treatment"] == "BOTOX FULL FACE"


async def test_once_confirmed_the_next_reminder_names_the_new_service(stored, in_memory_appointments):
    world = in_memory_appointments
    appointment_id = await _setup(world, stored)
    world.calendar.events = [_event(appointment_id, CHANGED)]
    await reminders.send_due_reminders(_at(9, 16))

    confirmed = await calendar_changes.confirm_calendar_change(appointment_id, tratamiento="  Botox  full face ")
    assert (confirmed["tratamiento"], confirmed["fecha"], confirmed["hora"]) == ("Botox full face", "2026-12-10", "16:00")
    assert confirmed["calendar_change"] is None

    assert await reminders.send_due_reminders(_at(10, 13)) == {"sent": 1}
    assert world.messenger.from_sender[-1]["parameters"] == [
        "Ana Pérez Torres", "Botox full face", "JUEVES 10 de Diciembre",
    ]
    # El título confirmado no vuelve a pedir confirmación.
    assert len([item for item in world.published if isinstance(item, AppointmentCalendarChanged)]) == 1

    with pytest.raises(NoCalendarChangePending):
        await calendar_changes.confirm_calendar_change(appointment_id, tratamiento="Botox")


async def test_a_calendar_put_back_as_the_crm_says_needs_no_confirmation(stored, in_memory_appointments):
    world = in_memory_appointments
    appointment_id = await _setup(world, stored)
    world.calendar.events = [_event(appointment_id, CHANGED)]
    await reminders.send_due_reminders(_at(9, 16))

    world.calendar.events = [_event(appointment_id, "HIFU 12D - 45678912 - Ana Pérez Torres - Rosa Vendedora")]
    assert await reminders.send_due_reminders(_at(10, 13)) == {"sent": 1}
    assert (await world.repository.get(appointment_id))["calendar_change"] is None

"""Los recordatorios de cita: se leen de Google Calendar y salen desde el
número de avisos un día, cinco horas, una hora antes (o lo que configure el
negocio), una sola vez por evento, anticipación y hora de inicio."""

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock
from zoneinfo import ZoneInfo

import pytest

from app.modules.appointments.application import commands, notice, reminders
from app.modules.appointments.domain.errors import CalendarUnavailable, NoticeNotSent
from app.modules.appointments.domain.notice import InvalidNotice
from app.modules.appointments.domain.reminders import (
    CalendarEvent,
    Reminder,
    describe_offset,
    due_reminders,
    extract_phone,
    parse_reminders,
)
from tests.appointment_fakes import in_memory_appointments  # noqa: F401

LIMA = ZoneInfo("America/Lima")
REMINDER = {
    "id": 21, "name": "recordatorio_cita", "content": "Hola {{1}}, te esperamos el {{2}} a las {{3}}",
    "template_type": "official", "official_status": "APPROVED", "visibility": "global", "is_active": True,
    "official_header_type": None, "official_name": "recordatorio_cita", "official_language": "es",
    "meta_template_id": "META_21", "official_parameter_values": ["Ana", "JUEVES 1 de Enero", "10:00 Am"],
}
PERSONAL = {**REMINDER, "id": 22, "visibility": "personal"}
FIELDS = ["{nombre_completo}", "{fecha_larga}", "{hora_12h}"]


@pytest.fixture
def stored(monkeypatch, in_memory_appointments):
    values: dict[str, str] = {"appointment_notice_phone_number_id": "AVISOS_ID"}

    async def update(new_values):
        values.update(new_values)

    def read(keys):
        return {key: values.get(key, "") for key in keys}

    for module in (notice, reminders):
        monkeypatch.setattr(module, "get_effective_many", AsyncMock(side_effect=read))
        monkeypatch.setattr(module, "list_templates", AsyncMock(return_value=[REMINDER, PERSONAL]))
    monkeypatch.setattr(notice, "update_settings", AsyncMock(side_effect=update))
    monkeypatch.setattr(reminders, "update_settings", AsyncMock(side_effect=update))
    monkeypatch.setattr(notice, "list_definitions", AsyncMock(return_value=[]))
    for module in (commands, reminders):
        monkeypatch.setattr(module, "effective_country_code", AsyncMock(return_value="51"))
    return values


def _at(day: int, hour: int, minute: int = 0) -> datetime:
    return datetime(2026, 12, day, hour, minute, tzinfo=LIMA)


def _event(**values) -> CalendarEvent:
    base = {
        "id": "evt-1", "starts_at": _at(10, 15), "ends_at": _at(10, 16), "summary": "Limpieza facial",
        "created_at": _at(1, 9), "appointment_id": None,
    }
    return CalendarEvent(**{**base, **values})


async def _configure(stored_values, *, manual=False, offsets=(1440, 300, 60)):
    await reminders.save_settings(
        include_manual_events=manual,
        reminders=[
            {"offset_minutes": offset, "enabled": True, "template_id": 21, "parameters": FIELDS} for offset in offsets
        ],
        user_id=1,
    )


async def _appointment(world, **values) -> int:
    row = await world.repository.add({
        "created_by_user_id": 1, "lead_id": "lead-1", "nombre_completo": "AYME", "telefono": "987654321",
        "tratamiento": "Limpieza facial", "fecha": "2026-12-09", "hora": "10:00", "duration_minutes": 60,
        "dni": "", "detalle": "", "vendedor": "Grecia", "adelanto": 0, "custom_fields": {}, "test_mode": False,
        "status": "created", **values,
    })
    return row["id"]


# --- Reglas -----------------------------------------------------------------


def test_without_configuration_there_are_three_reminders_switched_off():
    assert parse_reminders("") == (Reminder(1440), Reminder(300), Reminder(60))
    assert parse_reminders("no es json") == (Reminder(1440), Reminder(300), Reminder(60))
    assert describe_offset(1440) == "1 día"
    assert describe_offset(90) == "1 hora y 30 minutos"
    assert describe_offset(2 * 1440 + 300) == "2 días y 5 horas"


def test_a_reminder_is_due_from_its_time_until_its_margin_passes():
    day_before = (Reminder(1440, True, 21),)
    event = _event()
    assert due_reminders(day_before, event, _at(9, 14, 59)) == []
    assert due_reminders(day_before, event, _at(9, 15)) == list(day_before)
    # Un día antes tiene seis horas de margen (worker caído, Google lento)…
    assert due_reminders(day_before, event, _at(9, 20, 59)) == list(day_before)
    # …pero no le dice "falta un día" a quien tiene la cita en quince horas.
    assert due_reminders(day_before, event, _at(9, 21)) == []
    hour_before = (Reminder(60, True, 21),)
    assert due_reminders(hour_before, event, _at(10, 14, 14)) == list(hour_before)
    assert due_reminders(hour_before, event, _at(10, 14, 15)) == []


def test_an_event_created_after_its_reminder_time_does_not_get_it():
    # Agendada a veinte horas: el "falta un día" llegaría justo después de la
    # confirmación de la cita.
    event = _event(created_at=_at(9, 19))
    assert due_reminders((Reminder(1440, True, 21),), event, _at(9, 19, 1)) == []
    assert due_reminders((Reminder(300, True, 21),), event, _at(10, 10)) == [Reminder(300, True, 21)]


def test_switched_off_or_unconfigured_reminders_never_go_out():
    event = _event()
    assert due_reminders((Reminder(1440, False, 21), Reminder(1440, True, None)), event, _at(9, 15)) == []


def test_the_phone_of_a_manual_event_prefers_the_labelled_line():
    assert extract_phone("DNI 45678912\nTeléfono: +51 987 654 321") == "+51 987 654 321"
    assert extract_phone("Paciente nueva", "", "Ana 987-654-321") == "987-654-321"
    assert extract_phone("Cel. 987654321") == "987654321"
    assert extract_phone("Sin datos", "Sala 2") is None


# --- Configuración --------------------------------------------------------


async def test_reminders_are_saved_sorted_and_validated(stored, in_memory_appointments):
    result = await reminders.save_settings(
        include_manual_events=True,
        reminders=[
            {"offset_minutes": 60, "enabled": True, "template_id": 21, "parameters": FIELDS},
            {"offset_minutes": 1440, "enabled": False, "template_id": None, "parameters": []},
        ],
        user_id=1,
    )
    assert [item["offset_minutes"] for item in result["reminders"]] == [1440, 60]
    assert result["include_manual_events"] is True
    assert result["sender_ready"] is True
    assert result["calendar_ready"] is False
    assert [item["id"] for item in result["templates"]] == [21]

    with pytest.raises(InvalidNotice, match="dos recordatorios 1 hora"):
        await reminders.save_settings(include_manual_events=False, reminders=[
            {"offset_minutes": 60, "enabled": False}, {"offset_minutes": 60, "enabled": False},
        ], user_id=1)
    with pytest.raises(InvalidNotice, match="entre 15 minutos y 7 días"):
        await reminders.save_settings(include_manual_events=False, reminders=[
            {"offset_minutes": 5, "enabled": False},
        ], user_id=1)
    with pytest.raises(InvalidNotice, match="plantilla oficial aprobada"):
        await reminders.save_settings(include_manual_events=False, reminders=[
            {"offset_minutes": 60, "enabled": True, "template_id": 22, "parameters": FIELDS},
        ], user_id=1)
    with pytest.raises(InvalidNotice, match="3 variable"):
        await reminders.save_settings(include_manual_events=False, reminders=[
            {"offset_minutes": 60, "enabled": True, "template_id": 21, "parameters": FIELDS[:2]},
        ], user_id=1)


async def test_the_notice_number_copies_the_reminder_templates_too(stored, in_memory_appointments):
    await _configure(stored, offsets=(60,))
    assert await notice._notice_templates(1) == [("reminder", REMINDER)]


# --- Envío ------------------------------------------------------------------


async def test_a_crm_appointment_is_reminded_at_the_time_it_has_in_the_calendar(stored, in_memory_appointments):
    world = in_memory_appointments
    await _configure(stored)
    appointment_id = await _appointment(world)
    # La cita se cargó para el 9 a las 10:00 y en el calendario la movieron al 10 a las 15:00.
    world.calendar.events = [_event(appointment_id=appointment_id)]

    assert await reminders.send_due_reminders(_at(9, 15, 30)) == {"sent": 1}
    assert world.messenger.from_sender == [{
        "chat_id": "lead-1", "template_id": 21, "sender": "AVISOS_ID",
        "parameters": ["AYME", "JUEVES 10 de Diciembre", "03:00 Pm"],
    }]
    [row] = world.reminders.rows
    assert (row["offset_minutes"], row["status"], row["provider_message_id"]) == (1440, "sent", "wamid.lead.lead-1")
    # El calendario se lee hasta la anticipación más larga.
    assert world.calendar.reads[-1][1] - world.calendar.reads[-1][0] == timedelta(days=1, minutes=1)

    # La pasada siguiente no lo repite.
    assert await reminders.send_due_reminders(_at(9, 15, 31)) == {}
    assert len(world.messenger.from_sender) == 1

    # Movida de nuevo: la hora nueva tiene su propio recordatorio.
    world.calendar.events = [_event(appointment_id=appointment_id, starts_at=_at(10, 18), ends_at=_at(10, 19))]
    assert await reminders.send_due_reminders(_at(9, 18)) == {"sent": 1}


async def test_every_configured_reminder_goes_out_once(stored, in_memory_appointments):
    world = in_memory_appointments
    await _configure(stored)
    world.calendar.events = [_event(appointment_id=await _appointment(world))]
    for now in (_at(9, 15), _at(9, 15, 1), _at(10, 10), _at(10, 14), _at(10, 14, 5)):
        await reminders.send_due_reminders(now)
    assert [row["offset_minutes"] for row in world.reminders.rows] == [1440, 300, 60]
    assert len(world.messenger.from_sender) == 3


async def test_a_crm_appointment_without_lead_goes_to_its_phone(stored, in_memory_appointments):
    world = in_memory_appointments
    await _configure(stored, offsets=(60,))
    world.calendar.events = [_event(appointment_id=await _appointment(world, lead_id=None))]
    assert await reminders.send_due_reminders(_at(10, 14)) == {"sent": 1}
    assert world.messenger.to_phones == [{
        "phone": "51987654321", "template_id": 21, "sender": "AVISOS_ID",
        "parameters": ["AYME", "JUEVES 10 de Diciembre", "03:00 Pm"],
    }]


async def test_test_and_dismissed_appointments_are_never_reminded(stored, in_memory_appointments):
    world = in_memory_appointments
    await _configure(stored, offsets=(60,))
    test_id = await _appointment(world, test_mode=True)
    dismissed_id = await _appointment(world)
    await world.repository.set_dismissed(dismissed_id, user_id=1, reason="prueba")
    world.calendar.events = [
        _event(id="a", appointment_id=test_id), _event(id="b", appointment_id=dismissed_id),
    ]
    assert await reminders.send_due_reminders(_at(10, 14)) == {}
    assert world.reminders.rows == []


async def test_manual_events_need_the_setting_and_a_phone(stored, in_memory_appointments):
    world = in_memory_appointments
    await _configure(stored, offsets=(60,))
    world.calendar.events = [
        _event(id="con-telefono", description="Teléfono: 987 654 321"),
        _event(id="sin-telefono", description="Reunión de equipo"),
    ]
    assert await reminders.send_due_reminders(_at(10, 14)) == {}

    await _configure(stored, manual=True, offsets=(60,))
    assert await reminders.send_due_reminders(_at(10, 14)) == {"sent": 1, "skipped": 1}
    assert world.messenger.to_phones[0]["phone"] == "51987654321"
    assert world.messenger.to_phones[0]["parameters"] == ["-", "JUEVES 10 de Diciembre", "03:00 Pm"]
    skipped = next(row for row in world.reminders.rows if row["status"] == "skipped")
    assert skipped["reason"] == "El evento no trae un teléfono"


async def test_a_manual_event_of_a_known_lead_goes_with_its_name(stored, in_memory_appointments):
    world = in_memory_appointments
    world.leads.identities["51987654321"] = "lead-9"
    world.leads.snapshots["lead-9"] = {"nombre": "Rosa"}
    await _configure(stored, manual=True, offsets=(60,))
    world.calendar.events = [_event(description="Cel: 987654321")]
    assert await reminders.send_due_reminders(_at(10, 14)) == {"sent": 1}
    assert world.messenger.from_sender[0]["chat_id"] == "lead-9"
    assert world.messenger.from_sender[0]["parameters"][0] == "Rosa"


async def test_without_the_notice_number_or_the_calendar_nothing_goes_out(stored, in_memory_appointments):
    world = in_memory_appointments
    await _configure(stored, offsets=(60,))
    world.calendar.events = [_event(appointment_id=await _appointment(world))]
    stored["appointment_notice_phone_number_id"] = ""
    assert await reminders.send_due_reminders(_at(10, 14)) == {}
    assert world.calendar.reads == []

    stored["appointment_notice_phone_number_id"] = "AVISOS_ID"
    world.calendar.events_error = CalendarUnavailable("Google respondió 401")
    assert await reminders.send_due_reminders(_at(10, 14)) == {}
    assert world.reminders.rows == []


async def test_a_failed_send_is_recorded_and_the_pass_goes_on(stored, in_memory_appointments):
    world = in_memory_appointments
    await _configure(stored, offsets=(60,))
    world.messenger.error = NoticeNotSent("Meta rechazó la plantilla")
    world.calendar.events = [
        _event(id="a", appointment_id=await _appointment(world)),
        _event(id="b", appointment_id=await _appointment(world, lead_id=None)),
    ]
    assert await reminders.send_due_reminders(_at(10, 14)) == {"failed": 1, "sent": 1}
    failed = next(row for row in world.reminders.rows if row["status"] == "failed")
    assert failed["reason"] == "Meta rechazó la plantilla"


async def test_meta_statuses_reach_the_reminder(stored, in_memory_appointments):
    world = in_memory_appointments
    await _configure(stored, offsets=(60,))
    world.calendar.events = [_event(appointment_id=await _appointment(world))]
    await reminders.send_due_reminders(_at(10, 14))
    assert await notice.record_notice_delivery(
        provider_message_id="wamid.lead.lead-1", wsp_message_id=None, status="read", at=None,
    ) == 2  # el doble de avisos siempre cuenta uno
    assert world.reminders.deliveries == [{"provider_message_id": "wamid.lead.lead-1", "status": "read", "at": None}]


def test_utc_and_business_time_compare_as_the_same_instant():
    event = _event()
    utc_now = _at(10, 14).astimezone(timezone.utc)
    assert due_reminders((Reminder(60, True, 21),), event, utc_now) == [Reminder(60, True, 21)]

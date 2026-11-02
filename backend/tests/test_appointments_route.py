"""Alta y sincronización de citas por la ruta HTTP, con los conectores en
memoria: la cita local siempre se guarda primero."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from app.modules.appointments import api as appointments
from app.modules.appointments.application import commands
from app.modules.appointments.domain.appointment import SyncResult
from app.modules.appointments.domain.errors import CalendarNotConfigured
from app.modules.appointments.domain.events import AppointmentCreated
from app.modules.appointments.schemas import AppointmentCreate
from tests.appointment_fakes import in_memory_appointments  # noqa: F401

SELLER = SimpleNamespace(id=7, role="vendedor")


def _body(**overrides):
    return AppointmentCreate(**{
        "nombre_completo": "Ana Pérez", "telefono": "987654321",
        "tratamiento": "Consulta", "fecha": "2026-10-01", "hora": "10:00",
        "vendedor": "Antonella", **overrides,
    })


@pytest.fixture(autouse=True)
def dependencies(monkeypatch, in_memory_appointments):
    monkeypatch.setattr(appointments, "list_active_sellers", AsyncMock(return_value=[
        {"id": 1, "name": "Antonella", "role": "vendedor"},
    ]))
    monkeypatch.setattr(appointments, "effective_country_code", AsyncMock(return_value="51"))
    monkeypatch.setattr(commands, "effective_country_code", AsyncMock(return_value="51"))
    monkeypatch.setattr(appointments, "normalize_values", AsyncMock(side_effect=lambda _e, values, **_k: values))
    monkeypatch.setattr(commands, "list_definitions", AsyncMock(return_value=[]))
    return in_memory_appointments


async def test_local_appointment_is_saved_without_n8n(dependencies):
    result = await appointments.post_appointment(_body(), SELLER)

    assert result["success"] is True
    assert "calendario de la app" in result["message"]
    assert result["appointment"]["id"] == 41
    assert result["appointment"]["status"] == "created"
    [announced] = dependencies.of(AppointmentCreated)
    assert (announced.appointment_id, announced.created_by_user_id) == (41, SELLER.id)
    assert announced.title == "Nueva cita: Ana Pérez"


async def test_calendar_error_does_not_lose_local_appointment(dependencies):
    dependencies.calendar.result = {"status": "error", "event_id": None, "event_link": None, "error": "Google no disponible"}

    result = await appointments.post_appointment(_body(), SELLER)

    assert dependencies.repository.order == ["saved", "calendar", "n8n"]
    assert result["success"] is True
    assert result["appointment"]["status"] == "created_with_errors"
    assert result["integrationErrors"] == ["Google no disponible"]


async def test_n8n_failure_is_reported_after_local_commit(dependencies):
    dependencies.sync.result = SyncResult(configured=True, error="No se pudo sincronizar con n8n: sin conexión")

    result = await appointments.post_appointment(_body(), SELLER)

    assert dependencies.repository.order[0] == "saved"
    assert result["success"] is True
    assert result["appointment"]["status"] == "created_with_errors"
    assert "n8n" in result["integrationErrors"][0]


async def test_a_duplicate_reported_by_n8n_is_kept_as_such(dependencies):
    dependencies.sync.result = SyncResult(configured=True, payload={"success": True, "citaDuplicada": True, "message": "Ya existía"})

    result = await appointments.post_appointment(_body(), SELLER)

    assert result["appointment"]["status"] == "duplicate"
    assert result["message"] == "Ya existía"


async def test_a_test_appointment_skips_the_calendar_and_announces_nothing(dependencies):
    admin = SimpleNamespace(id=1, role="admin")

    result = await appointments.post_appointment(_body(test_mode=True), admin)

    assert dependencies.calendar.calls == []
    assert result["calendarSyncStatus"] == "skipped"
    assert dependencies.sync.submitted[0]["form"]["formMode"] == "test"
    assert dependencies.published == []


async def test_unknown_seller_is_rejected():
    with pytest.raises(HTTPException) as exc:
        await appointments.post_appointment(_body(vendedor="Alguien Más"), SELLER)
    assert exc.value.status_code == 400


async def test_phone_follows_the_configured_country(monkeypatch):
    with pytest.raises(HTTPException) as exc:
        await appointments.post_appointment(_body(telefono="12345"), SELLER)
    assert exc.value.status_code == 400

    monkeypatch.setattr(appointments, "effective_country_code", AsyncMock(return_value="54"))
    assert (await appointments.post_appointment(_body(telefono="1123456789"), SELLER))["success"] is True


async def test_test_mode_is_admin_only():
    with pytest.raises(HTTPException) as exc:
        await appointments.post_appointment(_body(test_mode=True), SELLER)
    assert exc.value.status_code == 403


async def _stored(world, **values):
    stored = await world.repository.add({
        "created_by_user_id": SELLER.id, "lead_id": None, "nombre_completo": "Ana Pérez", "dni": "",
        "telefono": "987654321", "tratamiento": "Consulta", "detalle": "", "fecha": "2026-10-01",
        "hora": "10:00", "vendedor": "Antonella", "adelanto": 0, "duration_minutes": 60,
        "custom_fields": {}, "comprobante_filename": None, "test_mode": False, "status": "created",
        "n8n_status": None, "message": None, "event_link": None, **values,
    })
    return stored["id"]


async def test_existing_appointment_can_be_synced_after_enabling_calendar(dependencies):
    appointment_id = await _stored(dependencies, calendar_sync_status="not_configured", calendar_sync_error="viejo")
    dependencies.calendar.result = {
        "status": "synced",
        "event_id": "google-event-1",
        "event_link": "https://calendar.google.com/event?eid=1",
        "error": None,
    }

    result = await appointments.sync_appointment_calendar(appointment_id, SELLER)

    assert result["calendar_sync_status"] == "synced"
    assert result["calendar_event_id"] == "google-event-1"
    assert result["calendar_sync_error"] is None


async def test_existing_appointment_explains_when_calendar_is_disabled(dependencies):
    appointment_id = await _stored(dependencies, calendar_sync_status="not_configured")

    with pytest.raises(CalendarNotConfigured) as exc:
        await appointments.sync_appointment_calendar(appointment_id, SELLER)

    assert exc.value.status_code == 409
    assert "Activa Google Calendar" in exc.value.detail

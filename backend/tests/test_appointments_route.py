"""Alta y sincronización de citas por la ruta HTTP, con los conectores en
memoria: la cita local siempre se guarda primero."""

from types import SimpleNamespace
from unittest.mock import AsyncMock
from zoneinfo import ZoneInfo

import pytest
from fastapi import HTTPException

from app.modules.appointments import api as appointments
from app.modules.appointments.application import calendar_template, commands
from app.modules.appointments.domain.appointment import SyncResult
from app.modules.appointments.domain.errors import (
    AppointmentNotFound,
    CalendarNotConfigured,
    DismissedAppointmentNotSynced,
)
from app.modules.appointments.schemas import AppointmentDismiss
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
    # Un teléfono sin lead ahora crea uno, que se entera de la cita a la hora del negocio.
    monkeypatch.setattr(commands, "business_timezone", AsyncMock(return_value=ZoneInfo("America/Lima")))
    monkeypatch.setattr(appointments, "normalize_values", AsyncMock(side_effect=lambda _e, values, **_k: values))
    monkeypatch.setattr(calendar_template, "list_definitions", AsyncMock(return_value=[]))
    monkeypatch.setattr(calendar_template, "get_effective_many", AsyncMock(return_value={
        calendar_template.TITLE_KEY: "", calendar_template.DESCRIPTION_KEY: "",
    }))
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


async def test_a_negative_deposit_is_rejected_and_decimals_are_kept(dependencies):
    """El adelanto es plata que dejó la clienta: un negativo es un error de
    tipeo que después restaría en los montos del dashboard."""
    with pytest.raises(HTTPException) as exc:
        await appointments.post_appointment(_body(custom_fields={"adelanto": -22}), SELLER)
    assert exc.value.status_code == 422
    assert "negativo" in exc.value.detail

    result = await appointments.post_appointment(_body(custom_fields={"adelanto": 14.5}), SELLER)
    assert result["success"] is True
    assert result["appointment"]["adelanto"] == 14.5


REQUEST_ID = "8b1f0c2e-4d5a-4f6b-9c7d-0e1f2a3b4c5d"


async def test_a_retry_returns_the_saved_appointment_without_repeating_anything(dependencies):
    """Las citas 425 y 426: la respuesta de la primera se perdió en un corte
    de conexión, la vendedora volvió a guardar y salieron dos avisos y dos
    eventos. El reintento lleva el mismo identificador y no crea nada."""
    first = await appointments.post_appointment(_body(client_request_id=REQUEST_ID), SELLER)
    retry = await appointments.post_appointment(_body(client_request_id=REQUEST_ID), SELLER)

    assert retry["appointment"]["id"] == first["appointment"]["id"]
    assert retry["alreadyRegistered"] is True
    assert retry["success"] is True
    assert len(dependencies.repository.rows) == 1
    assert len(dependencies.calendar.calls) == 1
    assert len(dependencies.sync.submitted) == 1
    assert len(dependencies.of(AppointmentCreated)) == 1
    assert len(dependencies.leads.created) == 1


async def test_another_attempt_id_is_another_appointment(dependencies):
    await appointments.post_appointment(_body(client_request_id=REQUEST_ID), SELLER)
    await appointments.post_appointment(_body(client_request_id="0f1e2d3c-4b5a-4968-8776-655443322110"), SELLER)
    await appointments.post_appointment(_body(), SELLER)

    assert len(dependencies.repository.rows) == 3
    assert len(dependencies.of(AppointmentCreated)) == 3


async def test_two_simultaneous_attempts_leave_a_single_appointment(dependencies, monkeypatch):
    """El segundo pedido no vio la cita al empezar, pero el primero la guardó
    antes de que el segundo llegara a insertar: el índice único lo frena."""
    saved = await dependencies.repository.add({**_stored_values(), "client_request_id": REQUEST_ID})
    monkeypatch.setattr(dependencies.repository, "by_client_request", AsyncMock(side_effect=[None, saved]))

    result = await appointments.post_appointment(_body(client_request_id=REQUEST_ID), SELLER)

    assert result["appointment"]["id"] == saved["id"]
    assert result["alreadyRegistered"] is True
    assert dependencies.calendar.calls == []
    assert dependencies.of(AppointmentCreated) == []


def _stored_values() -> dict:
    return {
        "created_by_user_id": SELLER.id, "lead_id": None, "nombre_completo": "Ana Pérez", "dni": "",
        "telefono": "987654321", "tratamiento": "Consulta", "detalle": "", "fecha": "2026-10-01",
        "hora": "10:00", "vendedor": "Antonella", "adelanto": 0, "duration_minutes": 60,
        "custom_fields": {}, "comprobante_filename": None, "test_mode": False, "status": "created",
        "n8n_status": None, "message": "Cita guardada en la app", "event_link": None,
        "calendar_sync_status": "pending",
    }


async def test_an_attempt_id_that_is_not_a_uuid_is_rejected():
    with pytest.raises(ValueError):
        _body(client_request_id="no-es-un-uuid")


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


ADMIN = SimpleNamespace(id=1, role="admin")


async def test_dismissed_appointment_keeps_who_and_why_and_can_be_restored(dependencies):
    appointment_id = await _stored(dependencies, calendar_sync_status="not_configured")

    dismissed = await appointments.dismiss_appointment(
        appointment_id, AppointmentDismiss(reason="  Prueba del permiso de Meta  "), ADMIN,
    )

    assert dismissed["dismissed_at"] is not None
    assert dismissed["dismissed_by_user_id"] == ADMIN.id
    assert dismissed["dismissed_reason"] == "Prueba del permiso de Meta"
    # Deja de ser la cita de ejemplo de las vistas previas.
    assert await dependencies.repository.latest_real() is None

    restored = await appointments.restore_appointment(appointment_id, ADMIN)

    assert (restored["dismissed_at"], restored["dismissed_reason"]) == (None, None)
    assert (await dependencies.repository.latest_real())["id"] == appointment_id


async def test_dismissing_without_reason_stores_none(dependencies):
    appointment_id = await _stored(dependencies, calendar_sync_status="not_configured")

    dismissed = await appointments.dismiss_appointment(appointment_id, AppointmentDismiss(reason="   "), ADMIN)

    assert dismissed["dismissed_reason"] is None


async def test_dismissing_a_missing_appointment_is_not_found(dependencies):
    with pytest.raises(AppointmentNotFound):
        await appointments.dismiss_appointment(999, AppointmentDismiss(), ADMIN)


async def test_dismissed_appointment_is_not_sent_to_the_calendar(dependencies):
    appointment_id = await _stored(dependencies, calendar_sync_status="not_configured")
    await appointments.dismiss_appointment(appointment_id, AppointmentDismiss(), ADMIN)

    with pytest.raises(DismissedAppointmentNotSynced):
        await appointments.sync_appointment_calendar(appointment_id, SELLER)

    assert dependencies.calendar.calls == []

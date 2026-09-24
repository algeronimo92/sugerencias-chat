from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from models.schemas import AppointmentCreate
from routers import appointments

SELLER = SimpleNamespace(id=7, role="vendedor")


def _body(**overrides):
    return AppointmentCreate(**{
        "nombre_completo": "Ana Pérez", "telefono": "987654321",
        "tratamiento": "Consulta", "fecha": "2026-10-01", "hora": "10:00",
        "vendedor": "Antonella", **overrides,
    })


def _stored(body, **extra):
    return {
        "id": 41, "created_by_user_id": SELLER.id, "created_by_name": "Asesor",
        "nombre_completo": body.nombre_completo, "dni": body.dni,
        "telefono": body.telefono, "tratamiento": body.tratamiento,
        "detalle": body.detalle, "fecha": body.fecha, "hora": body.hora,
        "vendedor": body.vendedor, "adelanto": body.adelanto,
        "duration_minutes": body.duration_minutes, "custom_fields": body.custom_fields,
        "comprobante_filename": None, "test_mode": body.test_mode,
        "status": "created", "n8n_status": None, "message": "Cita guardada en la app",
        "event_link": None, "calendar_event_id": None,
        "calendar_sync_status": "pending", "calendar_sync_error": None,
        "created_at": "2026-09-24T12:00:00Z", **extra,
    }


@pytest.fixture(autouse=True)
def dependencies(monkeypatch):
    monkeypatch.setattr(appointments, "list_active_sellers", AsyncMock(return_value=[
        {"id": 1, "name": "Antonella", "role": "vendedor"},
    ]))
    monkeypatch.setattr(appointments, "effective_country_code", AsyncMock(return_value="51"))
    monkeypatch.setattr(appointments, "get_effective", AsyncMock(return_value=""))
    monkeypatch.setattr(appointments, "normalize_values", AsyncMock(side_effect=lambda _e, values, **_k: values))
    monkeypatch.setattr(appointments, "list_definitions", AsyncMock(return_value=[]))
    monkeypatch.setattr(appointments, "create_google_event", AsyncMock(return_value={
        "status": "not_configured", "event_id": None, "event_link": None, "error": None,
    }))
    monkeypatch.setattr(appointments, "_notify_new_appointment", AsyncMock())


async def test_local_appointment_is_saved_without_n8n(monkeypatch):
    body = _body()
    create = AsyncMock(return_value=_stored(body))
    update = AsyncMock(side_effect=lambda _id, **values: _stored(body, **values))
    monkeypatch.setattr(appointments, "create_appointment_record", create)
    monkeypatch.setattr(appointments, "update_appointment_integrations", update)

    result = await appointments.post_appointment(body, SELLER)

    assert result["success"] is True
    assert "calendario de la app" in result["message"]
    create.assert_awaited_once()
    assert result["appointment"]["id"] == 41


async def test_calendar_error_does_not_lose_local_appointment(monkeypatch):
    body = _body()
    order = []

    async def create(**_kwargs):
        order.append("saved")
        return _stored(body)

    async def calendar(*_args):
        order.append("calendar")
        return {"status": "error", "event_id": None, "event_link": None, "error": "Google no disponible"}

    monkeypatch.setattr(appointments, "create_appointment_record", create)
    monkeypatch.setattr(appointments, "create_google_event", calendar)
    monkeypatch.setattr(appointments, "update_appointment_integrations", AsyncMock(side_effect=lambda _id, **values: _stored(body, **values)))

    result = await appointments.post_appointment(body, SELLER)

    assert order == ["saved", "calendar"]
    assert result["success"] is True
    assert result["appointment"]["status"] == "created_with_errors"
    assert result["integrationErrors"] == ["Google no disponible"]


async def test_unknown_seller_is_rejected():
    with pytest.raises(HTTPException) as exc:
        await appointments.post_appointment(_body(vendedor="Alguien Más"), SELLER)
    assert exc.value.status_code == 400


async def test_phone_follows_the_configured_country(monkeypatch):
    with pytest.raises(HTTPException) as exc:
        await appointments.post_appointment(_body(telefono="12345"), SELLER)
    assert exc.value.status_code == 400

    monkeypatch.setattr(appointments, "effective_country_code", AsyncMock(return_value="54"))
    body = _body(telefono="1123456789")
    monkeypatch.setattr(appointments, "create_appointment_record", AsyncMock(return_value=_stored(body)))
    monkeypatch.setattr(appointments, "update_appointment_integrations", AsyncMock(side_effect=lambda _id, **values: _stored(body, **values)))
    assert (await appointments.post_appointment(body, SELLER))["success"] is True


async def test_test_mode_is_admin_only():
    with pytest.raises(HTTPException) as exc:
        await appointments.post_appointment(_body(test_mode=True), SELLER)
    assert exc.value.status_code == 403


async def test_existing_appointment_can_be_synced_after_enabling_calendar(monkeypatch):
    body = _body()
    appointment = _stored(body, calendar_sync_status="not_configured")
    monkeypatch.setattr(appointments, "get_appointment", AsyncMock(return_value=appointment))
    monkeypatch.setattr(appointments, "create_google_event", AsyncMock(return_value={
        "status": "synced",
        "event_id": "google-event-1",
        "event_link": "https://calendar.google.com/event?eid=1",
        "error": None,
    }))
    update = AsyncMock(return_value=_stored(
        body,
        calendar_sync_status="synced",
        calendar_event_id="google-event-1",
        event_link="https://calendar.google.com/event?eid=1",
    ))
    monkeypatch.setattr(appointments, "update_appointment_integrations", update)

    result = await appointments.sync_appointment_calendar(41, SELLER)

    assert result["calendar_sync_status"] == "synced"
    assert result["calendar_event_id"] == "google-event-1"
    assert update.await_args.kwargs["clear_calendar_sync_error"] is True


async def test_existing_appointment_explains_when_calendar_is_disabled(monkeypatch):
    body = _body()
    monkeypatch.setattr(
        appointments,
        "get_appointment",
        AsyncMock(return_value=_stored(body, calendar_sync_status="not_configured")),
    )
    monkeypatch.setattr(appointments, "create_google_event", AsyncMock(return_value={
        "status": "not_configured", "event_id": None, "event_link": None, "error": None,
    }))
    monkeypatch.setattr(
        appointments,
        "update_appointment_integrations",
        AsyncMock(return_value=_stored(body, calendar_sync_status="not_configured")),
    )

    with pytest.raises(HTTPException) as exc:
        await appointments.sync_appointment_calendar(41, SELLER)

    assert exc.value.status_code == 409
    assert "Activa Google Calendar" in exc.value.detail

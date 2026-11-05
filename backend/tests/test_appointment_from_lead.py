"""Cita agendada desde la ficha del lead: va atada a ese lead sin adivinar
por teléfono y el lead se entera, salvo en modo prueba."""

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock
from zoneinfo import ZoneInfo

import pytest
from fastapi import HTTPException

from app.modules.appointments import api as appointments
from app.modules.appointments.application import calendar_template, commands
from app.modules.appointments.domain.appointment import LEAD_NOTE_MAX_LENGTH, lead_note
from app.modules.appointments.domain.errors import AppointmentLeadNotFound
from app.modules.appointments.schemas import AppointmentCreate
from tests.appointment_fakes import in_memory_appointments  # noqa: F401

SELLER = SimpleNamespace(id=7, role="vendedor")
ADMIN = SimpleNamespace(id=1, role="admin")
LEAD = "6f1c2e3a-0b4d-4c5e-8f9a-1b2c3d4e5f60"
LIMA = ZoneInfo("America/Lima")


def _body(**overrides):
    return AppointmentCreate(**{
        "nombre_completo": "Ana Pérez", "telefono": "987654321",
        "tratamiento": "Consulta", "fecha": "2026-11-12", "hora": "10:30",
        "vendedor": "Antonella", "lead_id": LEAD, **overrides,
    })


@pytest.fixture(autouse=True)
def world(monkeypatch, in_memory_appointments):
    monkeypatch.setattr(appointments, "list_active_sellers", AsyncMock(return_value=[
        {"id": 1, "name": "Antonella", "role": "vendedor"},
    ]))
    monkeypatch.setattr(appointments, "effective_country_code", AsyncMock(return_value="51"))
    monkeypatch.setattr(commands, "effective_country_code", AsyncMock(return_value="51"))
    monkeypatch.setattr(commands, "business_timezone", AsyncMock(return_value=LIMA))
    monkeypatch.setattr(appointments, "normalize_values", AsyncMock(side_effect=lambda _e, values, **_k: values))
    monkeypatch.setattr(calendar_template, "list_definitions", AsyncMock(return_value=[]))
    monkeypatch.setattr(calendar_template, "get_effective_many", AsyncMock(return_value={
        calendar_template.TITLE_KEY: "", calendar_template.DESCRIPTION_KEY: "",
    }))
    in_memory_appointments.leads.existing.add(LEAD)
    return in_memory_appointments


async def test_the_appointment_is_tied_to_the_lead_it_was_booked_from(world):
    # Otro lead tiene ese número como identidad: con el lead explícito no se adivina.
    world.leads.identities["51987654321"] = "otro-lead"

    result = await appointments.post_appointment(_body(), SELLER)

    assert result["appointment"]["lead_id"] == LEAD
    assert world.leads.tail_lookups == []
    [registered] = world.leads.registered
    assert registered["lead_id"] == LEAD
    assert registered["actor_user_id"] == SELLER.id
    assert registered["appointment"]["id"] == result["appointment"]["id"]
    assert registered["starts_at"] == datetime(2026, 11, 12, 10, 30, tzinfo=LIMA)
    assert (registered["updates"], registered["custom_fields"]) == ({}, {})
    assert registered["note"] == (
        "Cita agendada: Consulta\nFecha: 12/11/2026 a las 10:30 (60 min)\nResponsable: Antonella"
    )


async def test_carries_the_corrections_to_the_lead(world):
    body = _body(lead_updates={"nombre": "  Ana María ", "custom_fields": {"dni": "40404040"}})

    await appointments.post_appointment(body, SELLER)

    [registered] = world.leads.registered
    assert registered["updates"] == {"nombre": "Ana María"}
    assert registered["custom_fields"] == {"dni": "40404040"}


async def test_a_test_appointment_is_linked_but_leaves_the_lead_alone(world):
    result = await appointments.post_appointment(_body(test_mode=True), ADMIN)

    assert result["appointment"]["lead_id"] == LEAD
    assert world.leads.registered == []


async def test_a_missing_lead_saves_nothing(world):
    world.leads.existing.clear()

    with pytest.raises(AppointmentLeadNotFound):
        await appointments.post_appointment(_body(), SELLER)

    assert world.repository.rows == {}


async def test_lead_corrections_need_the_lead(world):
    with pytest.raises(HTTPException) as exc:
        await appointments.post_appointment(_body(lead_id=None, lead_updates={"nombre": "Ana"}), SELLER)
    assert exc.value.status_code == 400


async def test_without_a_lead_it_still_matches_by_phone(world):
    world.leads.identities["51987654321"] = "por-telefono"

    result = await appointments.post_appointment(_body(lead_id=None), SELLER)

    assert result["appointment"]["lead_id"] == "por-telefono"
    assert world.leads.registered == []


def test_the_lead_id_must_be_a_uuid():
    with pytest.raises(ValueError):
        _body(lead_id="no-es-un-uuid")


def test_the_lead_note_skips_what_the_appointment_does_not_have():
    note = lead_note({
        "tratamiento": "Limpieza", "fecha": "2026-11-12", "hora": "09:00",
        "duration_minutes": None, "vendedor": "", "detalle": "  Trae sus exámenes ",
    })

    assert note == "Cita agendada: Limpieza\nFecha: 12/11/2026 a las 09:00\nNotas: Trae sus exámenes"


def test_a_very_long_detail_does_not_block_the_note():
    note = lead_note({"tratamiento": "Limpieza", "fecha": "2026-11-12", "hora": "09:00", "detalle": "x" * 6000})

    assert len(note) == LEAD_NOTE_MAX_LENGTH

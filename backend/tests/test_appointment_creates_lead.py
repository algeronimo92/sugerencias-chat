"""Cita cargada desde Citas (sin ficha) para un teléfono sin lead: se busca
el lead en el CRM antes de crear uno, y solo si no aparece se crea.

Motivo: las citas 361 a 363 quedaron sin lead y el aviso al cliente se
salteó. En la 361 el lead existía, pero sin número: la clienta tenía usuario
de WhatsApp y Meta solo mandaba su BSUID; ella había dictado su número en el
chat 13 minutos antes. Crearle otro lead con ese número lo habría duplicado y,
cuando Meta mandara su ``wa_id``, los dos alias habrían chocado.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock
from zoneinfo import ZoneInfo

import pytest

from app.modules.appointments import api as appointments
from app.modules.appointments.application import calendar_template, commands
from app.modules.appointments.schemas import AppointmentCreate
from tests.appointment_fakes import in_memory_appointments  # noqa: F401

SELLER = SimpleNamespace(id=7, role="vendedor")
ADMIN = SimpleNamespace(id=1, role="admin")
LIMA = ZoneInfo("America/Lima")


def _body(**overrides):
    return AppointmentCreate(**{
        "nombre_completo": "  Lucía Torres ", "telefono": "980 000 275",
        "tratamiento": "HIFU 12D", "fecha": "2026-11-21", "hora": "15:00",
        "vendedor": "Antonella", **overrides,
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
    return in_memory_appointments


async def test_a_phone_nobody_has_gets_its_own_lead(world):
    result = await appointments.post_appointment(_body(), SELLER)

    assert world.leads.created == [{"phone": "51980000275", "name": "Lucía Torres", "actor_user_id": SELLER.id}]
    assert result["appointment"]["lead_id"] == "lead-nuevo-1"
    # El lead nuevo se entera de la cita como si se hubiera agendado desde su
    # ficha: próxima cita, actividad, nota y etapa.
    [registered] = world.leads.registered
    assert registered["lead_id"] == "lead-nuevo-1"


async def test_a_second_appointment_for_the_same_phone_reuses_that_lead(world):
    """Las citas 362 y 363 tenían el mismo número (dos clientas, un celular)."""
    await appointments.post_appointment(_body(), SELLER)
    result = await appointments.post_appointment(_body(nombre_completo="Rosa Medina"), SELLER)

    assert len(world.leads.created) == 1
    assert result["appointment"]["lead_id"] == "lead-nuevo-1"


async def test_a_phoneless_lead_that_wrote_the_number_is_used_instead(world):
    world.leads.chat_mentions["980000275"] = ["lead-con-bsuid"]

    result = await appointments.post_appointment(_body(), SELLER)

    assert world.leads.created == []
    assert result["appointment"]["lead_id"] == "lead-con-bsuid"
    # Igual que cuando se encuentra por teléfono: el lead no se toca.
    assert world.leads.registered == []


async def test_two_phoneless_candidates_link_nothing_and_create_nothing(world):
    world.leads.chat_mentions["980000275"] = ["uno", "otro"]

    result = await appointments.post_appointment(_body(), SELLER)

    assert world.leads.created == []
    assert result["appointment"]["lead_id"] is None


async def test_two_leads_with_that_phone_create_nothing(world):
    world.leads.tails["980000275"] = ["uno", "otro"]

    result = await appointments.post_appointment(_body(), SELLER)

    assert world.leads.created == []
    assert result["appointment"]["lead_id"] is None


async def test_a_test_appointment_never_creates_a_lead(world):
    result = await appointments.post_appointment(_body(test_mode=True), ADMIN)

    assert world.leads.created == []
    assert result["appointment"]["lead_id"] is None


async def test_a_failed_lead_creation_still_saves_the_appointment(world):
    world.leads.create_error = RuntimeError("la base no respondió")

    result = await appointments.post_appointment(_body(), SELLER)

    assert result["appointment"]["lead_id"] is None
    assert len(world.repository.rows) == 1

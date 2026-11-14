"""Agendar una cita desde la ficha del lead: qué le cambia al lead.

La cita en sí la prueba ``test_appointment_from_lead``; acá solo el lado del
lead, con el repositorio en memoria.
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from app.modules.leads.application import commands
from app.modules.leads.domain.errors import LeadNotFound
from app.modules.leads.domain.events import LeadAppointmentScheduled, LeadStageChanged, LeadUpdated
from app.modules.leads.domain.lead import Actor

SELLER = Actor.user(7)
STARTS_AT = datetime(2026, 11, 12, 15, 0, tzinfo=timezone.utc)
APPOINTMENT = {"id": 41, "fecha": "2026-11-12", "hora": "10:00", "tratamiento": "Limpieza", "vendedor": "Luis"}


async def _register(lead_id: str, **overrides) -> None:
    await commands.register_appointment(
        lead_id, actor=SELLER, appointment=APPOINTMENT, starts_at=STARTS_AT, **overrides,
    )


async def test_sets_the_next_appointment_and_leaves_it_in_the_activity(in_memory_leads):
    repo = in_memory_leads.repository
    lead_id = repo.seed()

    await _register(lead_id)

    assert repo.column(lead_id, "proxima_cita") == STARTS_AT
    updated, scheduled = repo.audit(lead_id)
    assert updated.event_type == "lead_updated"
    assert updated.metadata == {"source": "appointment", "appointment_id": 41}
    assert scheduled.event_type == "appointment_scheduled"
    assert scheduled.new_value == {"fecha": "2026-11-12", "hora": "10:00", "servicio": "Limpieza", "responsable": "Luis"}
    event, scheduled_event = in_memory_leads.published
    assert isinstance(event, LeadUpdated)
    assert event.fields == ("proxima_cita",)
    # La atribución lo informa a Meta como QualifiedLead (y Purchase con adelanto).
    assert isinstance(scheduled_event, LeadAppointmentScheduled)
    assert (scheduled_event.appointment_id, scheduled_event.adelanto) == (41, 0)


async def test_the_deposit_travels_with_the_scheduled_appointment(in_memory_leads):
    lead_id = in_memory_leads.repository.seed()

    await commands.register_appointment(
        lead_id, actor=SELLER, appointment={**APPOINTMENT, "adelanto": "80.50"}, starts_at=STARTS_AT,
    )

    [scheduled] = [e for e in in_memory_leads.published if isinstance(e, LeadAppointmentScheduled)]
    assert scheduled.adelanto == 80.5


async def test_carries_the_corrections_the_seller_asked_for(in_memory_leads):
    repo = in_memory_leads.repository
    lead_id = repo.seed(nombre="Ana", custom_fields={"dni": "1", "alergias": "no"})

    await _register(
        lead_id,
        updates={"nombre": "Ana Pérez", "vendedor_id": 99},
        custom_fields={"dni": "40404040"},
    )

    assert repo.column(lead_id, "nombre") == "Ana Pérez"
    # Solo corrige lo que se puede corregir desde la cita.
    assert repo.column(lead_id, "vendedor_id") is None
    # Los campos del negocio se suman: no borra los que no vinieron.
    assert repo.column(lead_id, "custom_fields") == {"dni": "40404040", "alergias": "no"}


async def test_without_a_marked_stage_the_lead_stays_where_it_is(in_memory_leads):
    repo = in_memory_leads.repository
    lead_id = repo.seed()

    await _register(lead_id)

    assert repo.column(lead_id, "estado") == "nuevo"
    assert not any(isinstance(event, LeadStageChanged) for event in in_memory_leads.published)


async def test_moves_forward_to_the_marked_stage(in_memory_leads):
    repo = in_memory_leads.repository
    repo.on_appointment = "agendado"
    lead_id = repo.seed(stage="calificado")

    await _register(lead_id)

    assert repo.column(lead_id, "estado") == "agendado"
    [moved] = [event for event in in_memory_leads.published if isinstance(event, LeadStageChanged)]
    assert (moved.old_stage, moved.new_stage) == ("calificado", "agendado")


@pytest.mark.parametrize("stage", ["agendado", "cliente_activo"])
async def test_never_moves_back_in_the_funnel(in_memory_leads, stage):
    repo = in_memory_leads.repository
    repo.on_appointment = "agendado"
    lead_id = repo.seed(stage=stage)

    await _register(lead_id)

    assert repo.column(lead_id, "estado") == stage


async def test_a_lost_lead_that_books_comes_back(in_memory_leads):
    repo = in_memory_leads.repository
    repo.on_appointment = "agendado"
    lead_id = repo.seed(stage="perdido", razon_perdido="Precio")

    await _register(lead_id)

    assert repo.column(lead_id, "estado") == "agendado"
    assert repo.column(lead_id, "razon_perdido") is None


async def test_an_inactive_marked_stage_is_ignored(in_memory_leads):
    repo = in_memory_leads.repository
    repo.on_appointment = "archivada"
    lead_id = repo.seed()

    await _register(lead_id)

    assert repo.column(lead_id, "estado") == "nuevo"


async def test_an_unreadable_time_does_not_touch_the_next_appointment(in_memory_leads):
    repo = in_memory_leads.repository
    lead_id = repo.seed()

    await commands.register_appointment(lead_id, actor=SELLER, appointment=APPOINTMENT, starts_at=None)

    assert repo.column(lead_id, "proxima_cita") is None
    [scheduled] = repo.audit(lead_id)
    assert scheduled.event_type == "appointment_scheduled"


async def test_an_unknown_lead_fails(in_memory_leads):
    with pytest.raises(LeadNotFound):
        await _register("no-existe")

"""Etapa "al agendar cita" y efectos de la cita sobre el lead, contra
PostgreSQL: el índice parcial (una sola etapa marcada) y el comando real del
lead, con su bloqueo de fila y su cambio de etapa en la misma transacción."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import select

from app.db.models.leads import Lead, LeadActivity, LeadStage
from app.db.uow import session_scope
from app.modules.leads.public import Actor, register_appointment
from app.modules.leads.infrastructure.repository import ensure_lead_stub
from app.modules.leads.stages import update_lead_stage_definition
from app.tenancy.context import tenant_context
from tests.postgres_fixtures import app_engine, pg_dsn, tenant  # noqa: F401

STARTS_AT = datetime(2026, 11, 12, 15, 30, tzinfo=timezone.utc)
APPOINTMENT = {"id": 41, "fecha": "2026-11-12", "hora": "10:30", "tratamiento": "Limpieza", "vendedor": "Ana"}


async def _marked() -> list[str]:
    async with session_scope() as session:
        return list((await session.execute(
            select(LeadStage.key).where(LeadStage.on_appointment.is_(True))
        )).scalars())


async def test_only_one_stage_is_marked_for_appointments(tenant):
    with tenant_context(tenant):
        await update_lead_stage_definition("agendado", {"on_appointment": True})
        assert await _marked() == ["agendado"]

        await update_lead_stage_definition("calificado", {"on_appointment": True})
        assert await _marked() == ["calificado"]

        # Desactivada deja de ser destino: pierde la marca.
        await update_lead_stage_definition("calificado", {"is_active": False})
        assert await _marked() == []


async def test_booking_from_the_lead_updates_it_in_one_transaction(tenant):
    with tenant_context(tenant):
        await update_lead_stage_definition("agendado", {"on_appointment": True})
        lead_id = str(uuid4())
        await ensure_lead_stub(lead_id, None, None)

        # El adaptador de citas lo llama con el usuario que agenda; un tenant
        # recién creado no tiene usuarios, así que va el actor de sistema.
        await register_appointment(
            lead_id, actor=Actor.system(), appointment=APPOINTMENT, starts_at=STARTS_AT,
            updates={"nombre": "Ana Pérez"},
        )

        async with session_scope() as session:
            lead = (await session.execute(
                select(Lead.estado, Lead.proxima_cita, Lead.nombre).where(Lead.id == lead_id)
            )).one()
            events = list((await session.execute(
                select(LeadActivity.event_type).where(LeadActivity.lead_id == lead_id).order_by(LeadActivity.id)
            )).scalars())

        assert lead.estado == "agendado"
        assert lead.proxima_cita == STARTS_AT
        assert lead.nombre == "Ana Pérez"
        assert events[-3:] == ["lead_updated", "appointment_scheduled", "stage_changed"]

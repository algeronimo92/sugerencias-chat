"""Etapas del embudo por negocio contra un PostgreSQL real.

Aprovisiona un tenant nuevo (recorre todas las migraciones, incluida
d9e2a4c7f1b5) y ejercita el ciclo completo: siembra, etapas propias, mover
leads con la semántica ``lost``, desactivar, borrar y reordenar. Se salta
igual que ``test_tenant_postgres_integration`` si no hay Postgres local.
"""

from __future__ import annotations

import secrets
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import select, text

from app.db.models.leads import Lead
from app.db.session import control_session, get_sessionmaker
from app.modules.leads.domain.errors import InvalidLeadStageError, LeadStageInUseError, LeadStageProtectedError
from app.modules.leads.stage_queries import list_lead_stages, list_stages_for_ai
from app.modules.leads.stages import create_lead_stage, delete_lead_stage, reorder_lead_stages, update_lead_stage_definition
from app.modules.leads.application.commands import change_stage
from app.modules.leads.domain.lead import Actor
from app.modules.leads.infrastructure.repository import ensure_lead_stub
from app.modules.leads.kanban_queries import fetch_kanban_counts
from app.tenancy.context import tenant_context, validate_schema_name
from app.tenancy.provisioning import provision_tenant
from tests.test_tenant_postgres_integration import pg_dsn, real_engine  # noqa: F401


SEEDED = [
    "nuevo", "en_diagnostico", "calificado", "oferta_presentada", "en_objecion",
    "agendado", "cliente_activo", "postventa", "en_seguimiento", "en_nutricion",
    "perdido", "descalificado", "baja",
]


@pytest_asyncio.fixture
async def tenant(real_engine):  # noqa: F811
    suffix = secrets.token_hex(4)
    context = await provision_tenant(
        name=f"Etapas Test {suffix}",
        hostname=f"etapas-test-{suffix}.integration.test",
    )
    try:
        yield context
    finally:
        async with control_session() as session:
            await session.execute(
                text("DELETE FROM public.organizations WHERE id = :id"),
                {"id": str(context.organization_id)},
            )
        async with real_engine.begin() as connection:
            schema = validate_schema_name(context.schema_name)
            await connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))


async def _lead_row(lead_id: str):
    async with get_sessionmaker()() as session:
        return (
            await session.execute(
                select(Lead.estado, Lead.razon_perdido).where(Lead.id == lead_id)
            )
        ).one()


@pytest.mark.asyncio
async def test_business_stages_lifecycle(tenant) -> None:
    with tenant_context(tenant):
        # Siembra: las 13 claves de siempre, en orden y con su tipo.
        stages = await list_lead_stages(include_usage=True)
        assert [stage["key"] for stage in stages] == SEEDED
        by_key = {stage["key"]: stage for stage in stages}
        assert by_key["en_diagnostico"]["name"] == "En diagnóstico"
        assert {key for key, stage in by_key.items() if stage["kind"] == "lost"} == {
            "perdido", "descalificado", "baja",
        }
        assert by_key["nuevo"]["is_system"] is True

        # Etapas propias: la clave sale del nombre y va al final del embudo.
        paid = await create_lead_stage(
            {"name": "Cita pagada", "color": "#0ea5e9", "kind": "won", "description": None}
        )
        silent = await create_lead_stage(
            {"name": "Sin respuesta", "color": "#78716c", "kind": "lost", "description": None}
        )
        assert paid["key"] == "cita_pagada"
        assert paid["position"] == len(SEEDED)
        assert silent["key"] == "sin_respuesta"

        # Un lead nuevo entra por la etapa inicial.
        lead_id = str(uuid4())
        await ensure_lead_stub(lead_id, None, "test")
        assert (await _lead_row(lead_id)).estado == "nuevo"

        moved = await change_stage(lead_id, "cita_pagada", actor=Actor.system())
        assert moved.changed is True
        assert (await _lead_row(lead_id)).estado == "cita_pagada"

        # La razón de pérdida sigue al tipo `lost`, no al nombre `perdido`.
        await change_stage(lead_id, "sin_respuesta", lost_reason="No contesta", actor=Actor.system())
        assert tuple(await _lead_row(lead_id)) == ("sin_respuesta", "No contesta")
        await change_stage(lead_id, "calificado", actor=Actor.system())
        assert tuple(await _lead_row(lead_id)) == ("calificado", None)

        # Nadie mueve un lead a una etapa desactivada o inexistente.
        await update_lead_stage_definition("sin_respuesta", {"is_active": False})
        with pytest.raises(InvalidLeadStageError):
            await change_stage(lead_id, "sin_respuesta", actor=Actor.system())
        with pytest.raises(InvalidLeadStageError):
            await change_stage(lead_id, "inventada", actor=Actor.system())
        assert "sin_respuesta" not in {stage["key"] for stage in await list_stages_for_ai()}

        # La etapa inicial está protegida; una en uso no se borra.
        with pytest.raises(LeadStageProtectedError):
            await update_lead_stage_definition("nuevo", {"is_active": False})
        with pytest.raises(LeadStageProtectedError):
            await delete_lead_stage("nuevo")
        with pytest.raises(LeadStageInUseError):
            await delete_lead_stage("calificado")
        await delete_lead_stage("cita_pagada")

        # Renombrar no cambia la clave: el lead sigue en la misma etapa.
        renamed = await update_lead_stage_definition("calificado", {"name": "Interesado"})
        assert renamed["key"] == "calificado"
        assert (await _lead_row(lead_id)).estado == "calificado"

        keys = [stage["key"] for stage in await list_lead_stages()]
        reordered = await reorder_lead_stages(list(reversed(keys)))
        assert [stage["key"] for stage in reordered] == list(reversed(keys))

        # El kanban trae una columna por etapa del negocio, en su orden.
        counts = await fetch_kanban_counts()
        assert list(counts) == list(reversed(keys))
        assert counts["calificado"] == 1


@pytest.mark.asyncio
async def test_stage_changes_are_announced_only_after_a_commit(tenant, monkeypatch) -> None:
    """Cada comando de etapas registra LeadStagesChanged en su unidad de
    trabajo: sale si confirmó y no sale si falló."""
    from app.db import uow
    from app.modules.leads.domain.errors import LeadStageNotFoundError
    from app.modules.leads.domain.events import LeadStagesChanged

    announced = []

    async def record(events):
        announced.extend(events)

    monkeypatch.setattr(uow, "dispatch_after_commit", record)
    with tenant_context(tenant):
        await create_lead_stage({"name": "Cita pagada", "color": "#0ea5e9"})
        with pytest.raises(LeadStageNotFoundError):
            await delete_lead_stage("no_existe")

    assert announced == [LeadStagesChanged()]

"""Pausa de automatización: la del lead entero (automatizacion_pausada) y la de
una sola ejecución (pause_scope).

Al pausar el lead, lo que ya quedó SCHEDULED de un trigger de sistema se
congela (PAUSED) y al reanudar vuelve a la cola con el tiempo que le faltaba.
El botón de pausa de una ejecución puntual usa el mismo congelado, pero marcado
con pause_scope='execution' para que reanudar el lead no lo pise.

Qué filas toca cada operación es SQL y está en
``test_automation_store_postgres``; acá se prueba la decisión y el aviso.
"""

from unittest.mock import AsyncMock

import pytest

from app.modules.automations.ports.types import AutomationExecutionStatus
from app.modules.automations.application import management
from app.modules.automations.application.management import (
    pause_automation_execution,
    pause_lead_executions,
    resume_automation_execution,
    resume_lead_executions,
)
from app.modules.automations.domain.events import AutomationsChanged
from app.modules.automations.domain.errors import AutomationConflict
from tests.automation_fakes import execution

LEAD = "lead-1"


async def test_pausing_a_lead_freezes_what_it_had_scheduled_and_says_so(in_memory_automations):
    store = in_memory_automations.executions
    store.add(execution(id=1, lead_id=LEAD))
    store.add(execution(id=2, lead_id=LEAD, start_source="manual"))

    frozen = await pause_lead_executions(LEAD)

    assert frozen == 1
    assert store.executions[1].status == AutomationExecutionStatus.PAUSED
    # Un flujo manual del vendedor lo pidió a propósito: la pausa no lo toca.
    assert store.executions[2].status == AutomationExecutionStatus.SCHEDULED
    assert in_memory_automations.of(AutomationsChanged) == [AutomationsChanged()]


async def test_pausing_a_lead_with_nothing_scheduled_says_nothing(in_memory_automations):
    assert await pause_lead_executions(LEAD) == 0
    assert in_memory_automations.published == []


async def test_resuming_a_lead_wakes_the_worker(in_memory_automations):
    """El worker tiene que enterarse: si no, lo reanudado espera al próximo
    ciclo del bucle aunque ya venciera durante la pausa."""
    store = in_memory_automations.executions
    store.add(execution(id=1, lead_id=LEAD, status=AutomationExecutionStatus.PAUSED, pause_scope="lead"))
    store.add(execution(id=2, lead_id=LEAD, status=AutomationExecutionStatus.PAUSED, pause_scope="execution"))

    resumed = await resume_lead_executions(LEAD)

    assert resumed == 1
    # Lo que el vendedor pausó a mano solo vuelve con su propio botón.
    assert store.executions[2].status == AutomationExecutionStatus.PAUSED
    assert in_memory_automations.of(AutomationsChanged) == [AutomationsChanged(wake=True)]


async def test_resuming_a_lead_with_nothing_frozen_says_nothing(in_memory_automations):
    assert await resume_lead_executions(LEAD) == 0
    assert in_memory_automations.published == []


async def test_pausing_one_execution_freezes_only_that_one(in_memory_automations):
    store = in_memory_automations.executions
    store.add(execution(id=7, lead_id=LEAD, start_source="manual"))
    store.add(execution(id=8, lead_id=LEAD))

    item = await pause_automation_execution(7)

    assert item == {"id": 7, "status": AutomationExecutionStatus.PAUSED}
    assert store.executions[7].pause_scope == "execution"
    assert store.executions[8].status == AutomationExecutionStatus.SCHEDULED
    assert in_memory_automations.of(AutomationsChanged) == [AutomationsChanged()]


async def test_a_running_execution_is_not_paused_mid_step(in_memory_automations):
    in_memory_automations.executions.add(execution(id=7, status=AutomationExecutionStatus.RUNNING))

    assert await pause_automation_execution(7) is None
    assert in_memory_automations.published == []


async def test_resuming_one_execution_wakes_the_worker(in_memory_automations, monkeypatch):
    in_memory_automations.executions.add(
        execution(id=7, lead_id=LEAD, status=AutomationExecutionStatus.PAUSED, pause_scope="execution"),
    )
    monkeypatch.setattr(management, "fetch_lead_raw", AsyncMock(return_value={"automatizacion_pausada": False}))

    item = await resume_automation_execution(7)

    assert item == {"id": 7, "status": AutomationExecutionStatus.SCHEDULED}
    assert in_memory_automations.of(AutomationsChanged) == [AutomationsChanged(wake=True)]


async def test_resuming_one_execution_is_refused_while_the_lead_is_paused(in_memory_automations, monkeypatch):
    """Sin esto el botón aparentaría no hacer nada: el motor volvería a
    congelar la ejecución en cuanto venciera."""
    in_memory_automations.executions.add(
        execution(id=7, lead_id=LEAD, status=AutomationExecutionStatus.PAUSED),
    )
    monkeypatch.setattr(management, "fetch_lead_raw", AsyncMock(return_value={"automatizacion_pausada": True}))

    with pytest.raises(AutomationConflict, match="botón del bot") as caught:
        await resume_automation_execution(7)
    assert caught.value.status_code == 409
    assert in_memory_automations.executions.executions[7].status == AutomationExecutionStatus.PAUSED


async def test_the_lead_pause_never_blocks_resuming_a_manual_flow(in_memory_automations, monkeypatch):
    in_memory_automations.executions.add(
        execution(id=7, lead_id=LEAD, status=AutomationExecutionStatus.PAUSED, start_source="manual"),
    )
    lead = AsyncMock(return_value={"automatizacion_pausada": True})
    monkeypatch.setattr(management, "fetch_lead_raw", lead)

    assert await resume_automation_execution(7) == {"id": 7, "status": AutomationExecutionStatus.SCHEDULED}
    # Ni miró el lead.
    lead.assert_not_awaited()


async def test_only_a_paused_execution_can_be_resumed(in_memory_automations):
    in_memory_automations.executions.add(execution(id=7, status=AutomationExecutionStatus.SCHEDULED))

    assert await resume_automation_execution(7) is None
    assert in_memory_automations.published == []

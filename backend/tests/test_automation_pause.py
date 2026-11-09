"""Pausa de automatización: la del lead entero (automatizacion_pausada) y la de
una sola ejecución (pause_scope).

Pausar el lead ya no congela nada: el botón del bot del chat solo impide que
los disparadores creen ejecuciones nuevas (eso vive en schedule_in_session), y
lo que está en marcha se detiene una por una desde el chat, marcado con
pause_scope='execution'. Reactivar el lead todavía descongela lo que la regla
anterior dejó pausado en producción (pause_scope 'lead' o NULL) sin pisar lo
que el vendedor pausó a mano.

Qué filas toca cada operación es SQL y está en
``test_automation_store_postgres``; acá se prueba la decisión y el aviso.
"""

import pytest

from app.modules.automations.ports.types import AutomationExecutionStatus
from app.modules.automations.application import management
from app.modules.automations.application.management import (
    pause_automation_execution,
    resume_automation_execution,
    resume_lead_executions,
)
from app.modules.automations.domain.events import AutomationsChanged
from app.modules.automations.subscribers import follow_lead_pause
from app.modules.leads.domain.events import LeadUpdated
from app.modules.leads.domain.lead import Actor
from tests.automation_fakes import execution

LEAD = "lead-1"


def lead_pause_event(paused: bool) -> LeadUpdated:
    return LeadUpdated(
        lead_id=LEAD, actor=Actor.system(), fields=("automatizacion_pausada",), event_type="lead_updated",
        values={"automatizacion_pausada": paused},
    )


async def test_pausing_a_lead_leaves_what_is_running_alone(in_memory_automations):
    """El botón del bot solo frena lanzamientos nuevos. Hasta el 2026-11-09
    congelaba las ejecuciones de sistema y el vendedor veía dos pausas que
    prometían lo mismo."""
    store = in_memory_automations.executions
    store.add(execution(id=1, lead_id=LEAD))
    store.add(execution(id=2, lead_id=LEAD, start_source="manual"))

    await follow_lead_pause(lead_pause_event(True))

    assert store.executions[1].status == AutomationExecutionStatus.SCHEDULED
    assert store.executions[2].status == AutomationExecutionStatus.SCHEDULED
    assert in_memory_automations.published == []


async def test_reactivating_a_lead_thaws_what_the_old_rule_froze(in_memory_automations):
    store = in_memory_automations.executions
    store.add(execution(id=1, lead_id=LEAD, status=AutomationExecutionStatus.PAUSED, pause_scope="lead"))

    await follow_lead_pause(lead_pause_event(False))

    assert store.executions[1].status == AutomationExecutionStatus.SCHEDULED


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


async def test_resuming_one_execution_wakes_the_worker(in_memory_automations):
    in_memory_automations.executions.add(
        execution(id=7, lead_id=LEAD, status=AutomationExecutionStatus.PAUSED, pause_scope="execution"),
    )

    item = await resume_automation_execution(7)

    assert item == {"id": 7, "status": AutomationExecutionStatus.SCHEDULED}
    assert in_memory_automations.of(AutomationsChanged) == [AutomationsChanged(wake=True)]


async def test_resuming_one_execution_works_while_the_lead_is_paused(in_memory_automations):
    """El bot del chat en pausa ya no congela nada, así que reanudar una
    ejecución a mano no tiene por qué pedir reactivar el bot antes."""
    in_memory_automations.executions.add(
        execution(id=7, lead_id=LEAD, status=AutomationExecutionStatus.PAUSED),
    )

    assert await resume_automation_execution(7) == {"id": 7, "status": AutomationExecutionStatus.SCHEDULED}


async def test_only_a_paused_execution_can_be_resumed(in_memory_automations):
    in_memory_automations.executions.add(execution(id=7, status=AutomationExecutionStatus.SCHEDULED))

    assert await resume_automation_execution(7) is None
    assert in_memory_automations.published == []

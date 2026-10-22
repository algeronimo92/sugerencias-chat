"""El ciclo del motor sobre lo que reclama: corre lo vencido y avisa.

Cómo se reclama (qué columnas toca, qué congela, cuándo cuenta un intento)
es SQL y se prueba contra PostgreSQL en ``test_automation_store_postgres``.
"""

import dataclasses
from unittest.mock import AsyncMock

from app.modules.automations.application import engine
from app.modules.automations.domain.events import AutomationsChanged


async def test_claimed_executions_run_and_the_panels_are_told_once(deps, executions, recorder, monkeypatch):
    executions.due = [777, 778]
    ran = AsyncMock()
    monkeypatch.setattr(engine, "run_execution", ran)

    processed = await engine.process_due_automation_executions(limit=5, deps=deps)

    assert processed == 2
    assert sorted(call.args[0] for call in ran.await_args_list) == [777, 778]
    assert recorder.of(AutomationsChanged) == [AutomationsChanged()]


async def test_due_executions_of_a_paused_lead_are_frozen_instead_of_run(deps, executions, recorder, monkeypatch):
    """Atrapa a la ejecución que estaba corriendo cuando el vendedor pausó y
    volvió a la cola al llegar a su siguiente espera: sin este congelado
    seguiría recorriendo el flujo entero con el lead pausado."""
    executions.frozen = [42]
    ran = AsyncMock()
    monkeypatch.setattr(engine, "run_execution", ran)

    processed = await engine.process_due_automation_executions(limit=5, deps=deps)

    assert processed == 0
    ran.assert_not_awaited()
    assert recorder.of(AutomationsChanged) == [AutomationsChanged()]


async def test_an_idle_cycle_says_nothing(deps, recorder):
    processed = await engine.process_due_automation_executions(limit=5, deps=dataclasses.replace(deps))

    assert processed == 0
    assert recorder.events == []

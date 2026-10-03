"""Tests de los dos frenos del motor: cooldown por lead y tope por hora.

Ambos nacieron de un incidente real: un flujo disparado por "mensaje recibido"
le mandó la misma plantilla al mismo cliente dos veces con 31 segundos de
diferencia, porque cada mensaje entrante agenda su propia ejecución.
"""

import dataclasses
from datetime import timedelta
from unittest.mock import AsyncMock

from domain_types import AutomationExecutionStatus
from app.modules.automations.application.conditions import matches_condition_values
from app.modules.automations.application.engine import _rate_limit_reached, run_execution
from app.modules.automations.domain.limits import RATE_LIMIT_RETRY_MINUTES
from tests.automation_fakes import execution
from tests.conftest import make_chat, make_rule


def completed(executions, frozen_now, *, count=1, minutes_ago=5, lead_id="4316bc30-f78c-57a2-8f98-bff9087678d6"):
    """Ejecuciones de la regla 1 completadas hace ``minutes_ago`` minutos."""
    for offset in range(count):
        executions.add(execution(
            id=500 + len(executions.executions) + offset, rule_id=1, lead_id=lead_id,
            status=AutomationExecutionStatus.COMPLETED,
            finished_at=frozen_now - timedelta(minutes=minutes_ago),
        ))


class TestCooldown:
    async def test_blocks_when_a_recent_completed_execution_exists(self, deps, executions, frozen_now):
        completed(executions, frozen_now, minutes_ago=10)
        matches, reason = await matches_condition_values({"cooldown_minutes": 30}, make_chat(), 1, deps)
        assert matches is False
        assert "menos de 30 minutos" in reason

    async def test_allows_when_no_recent_execution(self, deps, executions, frozen_now):
        completed(executions, frozen_now, minutes_ago=45)
        matches, reason = await matches_condition_values({"cooldown_minutes": 30}, make_chat(), 1, deps)
        assert matches is True
        assert reason is None

    async def test_only_counts_executions_on_the_same_lead(self, deps, executions, frozen_now):
        completed(executions, frozen_now, minutes_ago=10, lead_id="otro-lead")
        matches, _ = await matches_condition_values({"cooldown_minutes": 30}, make_chat(), 1, deps)
        assert matches is True

    async def test_is_ignored_when_not_configured(self, deps, executions, frozen_now):
        completed(executions, frozen_now, minutes_ago=1)
        matches, _ = await matches_condition_values({}, make_chat(), 1, deps)
        assert matches is True

    async def test_is_ignored_without_rule_id(self, deps, executions, frozen_now):
        completed(executions, frozen_now, minutes_ago=1)
        matches, _ = await matches_condition_values({"cooldown_minutes": 30}, make_chat(), None, deps)
        assert matches is True


class TestRateLimit:
    async def test_not_reached_when_rule_has_no_limit(self, deps, executions, frozen_now):
        completed(executions, frozen_now, count=50)
        assert await _rate_limit_reached(make_rule(max_executions_per_hour=None), deps) is False

    async def test_reached_when_count_hits_the_cap(self, deps, executions, frozen_now):
        completed(executions, frozen_now, count=5)
        assert await _rate_limit_reached(make_rule(max_executions_per_hour=5), deps) is True

    async def test_not_reached_below_the_cap(self, deps, executions, frozen_now):
        completed(executions, frozen_now, count=4)
        assert await _rate_limit_reached(make_rule(max_executions_per_hour=5), deps) is False

    async def test_only_the_last_hour_counts(self, deps, executions, frozen_now):
        completed(executions, frozen_now, count=5, minutes_ago=61)
        assert await _rate_limit_reached(make_rule(max_executions_per_hour=1), deps) is False


class TestRateLimitReschedules:
    async def test_execution_is_requeued_not_discarded(self, deps, executions, frozen_now):
        """El tope frena el ritmo; el trabajo pendiente no se pierde."""
        completed(executions, frozen_now, count=5)
        executions.add(execution(id=1, rule_id=1, status=AutomationExecutionStatus.RUNNING),
                       make_rule(max_executions_per_hour=1, builder_mode="simple"))
        deps = dataclasses.replace(deps, fetch_chat=AsyncMock(return_value=make_chat()))

        await run_execution(1, deps)

        [(execution_id, values)] = executions.saves
        assert execution_id == 1
        # Vuelve a la cola en vez de quedar failed, y con una fecha futura.
        assert values["status"] == AutomationExecutionStatus.SCHEDULED
        assert values["scheduled_for"] == frozen_now + timedelta(minutes=RATE_LIMIT_RETRY_MINUTES)
        assert values["started_at"] is None
        assert "ejecuciones/hora" in values["error"]

    def test_retry_delay_is_a_sane_value(self):
        assert timedelta(minutes=RATE_LIMIT_RETRY_MINUTES) <= timedelta(hours=1)

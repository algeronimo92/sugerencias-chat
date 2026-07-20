"""Tests de los dos frenos del motor: cooldown por lead y tope por hora.

Ambos nacieron de un incidente real: un flujo disparado por "mensaje recibido"
le mandó la misma plantilla al mismo cliente dos veces con 31 segundos de
diferencia, porque cada mensaje entrante agenda su propia ejecución.
"""

import dataclasses
from datetime import timedelta
from types import SimpleNamespace

from domain_types import AutomationExecutionStatus
from services.automation_service import (
    RATE_LIMIT_RETRY_MINUTES,
    _matches_condition_values,
    _rate_limit_reached,
)
from tests.conftest import make_chat, make_rule


def deps_returning(deps, *, scalar):
    """Sustituye la sesión por una que devuelve `scalar` en cualquier consulta."""

    class FakeSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def scalar(self, stmt):
            return scalar

    return dataclasses.replace(deps, session_factory=lambda: FakeSession)


class TestCooldown:
    async def test_blocks_when_a_recent_completed_execution_exists(self, deps):
        blocked = deps_returning(deps, scalar=999)  # id de una ejecución reciente
        matches, reason = await _matches_condition_values(
            {"cooldown_minutes": 30}, make_chat(), rule_id=1, deps=blocked,
        )
        assert matches is False
        assert "menos de 30 minutos" in reason

    async def test_allows_when_no_recent_execution(self, deps):
        free = deps_returning(deps, scalar=None)
        matches, reason = await _matches_condition_values(
            {"cooldown_minutes": 30}, make_chat(), rule_id=1, deps=free,
        )
        assert matches is True
        assert reason is None

    async def test_is_ignored_when_not_configured(self, deps):
        # Sin cooldown no debe consultarse la base: la sesión falsa reventaría.
        matches, _ = await _matches_condition_values({}, make_chat(), rule_id=1, deps=deps)
        assert matches is True

    async def test_is_ignored_without_rule_id(self, deps):
        matches, _ = await _matches_condition_values(
            {"cooldown_minutes": 30}, make_chat(), rule_id=None, deps=deps,
        )
        assert matches is True


class TestRateLimit:
    async def test_not_reached_when_rule_has_no_limit(self, deps):
        assert await _rate_limit_reached(make_rule(max_executions_per_hour=None), deps) is False

    async def test_reached_when_count_hits_the_cap(self, deps):
        at_cap = deps_returning(deps, scalar=5)
        assert await _rate_limit_reached(make_rule(max_executions_per_hour=5), at_cap) is True

    async def test_not_reached_below_the_cap(self, deps):
        below = deps_returning(deps, scalar=4)
        assert await _rate_limit_reached(make_rule(max_executions_per_hour=5), below) is False

    async def test_handles_null_count_from_database(self, deps):
        empty = deps_returning(deps, scalar=None)
        assert await _rate_limit_reached(make_rule(max_executions_per_hour=1), empty) is False


class TestRateLimitReschedules:
    async def test_execution_is_requeued_not_discarded(self, deps, frozen_now):
        """El tope frena el ritmo; el trabajo pendiente no se pierde."""
        saved = {}

        class FakeSession:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *exc):
                return False

            async def get(self, model, pk):
                name = getattr(model, "__name__", "")
                if name == "AutomationExecution":
                    return SimpleNamespace(
                        id=1, rule_id=1, lead_id="x", action_results=[],
                        event_payload={}, flow_state={},
                    )
                return make_rule(max_executions_per_hour=1, builder_mode="simple")

            async def scalar(self, stmt):
                return 5  # ya se completaron 5 en la última hora

            async def execute(self, stmt):
                # Los valores van como parámetros ligados; str(stmt) solo
                # mostraría los nombres de columna.
                saved["params"] = stmt.compile().params
                return SimpleNamespace(rowcount=1)

            async def commit(self):
                saved["committed"] = True

        from services.automation_service import _run_execution

        await _run_execution(1, dataclasses.replace(deps, session_factory=lambda: FakeSession))

        assert saved.get("committed") is True
        params = saved["params"]
        # Vuelve a la cola en vez de quedar failed, y con una fecha futura.
        assert params["status"] == AutomationExecutionStatus.SCHEDULED
        assert params["scheduled_for"] == frozen_now + timedelta(minutes=RATE_LIMIT_RETRY_MINUTES)
        assert params["started_at"] is None
        assert "ejecuciones/hora" in params["error"]

    def test_retry_delay_is_a_sane_value(self):
        assert timedelta(minutes=RATE_LIMIT_RETRY_MINUTES) <= timedelta(hours=1)

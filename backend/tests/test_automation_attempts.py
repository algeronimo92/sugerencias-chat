"""attempts cuenta recuperaciones de ejecuciones atascadas, no reclamos
normales del watcher — una ejecución con varias pausas legítimas (wait_any)
no debe acercarse nunca a MAX_EXECUTION_ATTEMPTS."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from sqlalchemy.dialects import postgresql

from domain_types import AutomationExecutionStatus
from services import automation_service


class _SessionContext:
    def __init__(self, session):
        self._session = session

    async def __aenter__(self):
        return self._session

    async def __aexit__(self, *_args):
        return False


def _sessionmaker(session):
    return lambda: (lambda: _SessionContext(session))


def _compile(statement) -> str:
    return str(statement.compile(
        dialect=postgresql.dialect(),
        compile_kwargs={"literal_binds": True},
    ))


class _ClaimResult:
    def __init__(self, ids):
        self._ids = ids

    def scalars(self):
        return self

    def all(self):
        return self._ids


@pytest.mark.asyncio
async def test_claiming_due_executions_does_not_increment_attempts(monkeypatch):
    session = AsyncMock()
    # Tres statements por ciclo: congelar lo vencido de leads pausados,
    # seleccionar lo reclamable y marcarlo running.
    session.execute = AsyncMock(side_effect=[
        _ClaimResult([]), _ClaimResult([777]), SimpleNamespace(),
    ])
    monkeypatch.setattr(automation_service, "get_sessionmaker", _sessionmaker(session))
    monkeypatch.setattr(automation_service, "_run_execution", AsyncMock())
    monkeypatch.setattr(automation_service, "manager", SimpleNamespace(broadcast=AsyncMock()))

    await automation_service.process_due_automation_executions(limit=5)

    claim_sql = _compile(session.execute.await_args_list[2].args[0])
    assert "attempts" not in claim_sql
    assert "'running'" in claim_sql


@pytest.mark.asyncio
async def test_due_executions_of_a_paused_lead_are_frozen_instead_of_run(monkeypatch):
    """Atrapa a la ejecución que estaba corriendo cuando el vendedor pausó y
    volvió a la cola al llegar a su siguiente espera: sin este congelado
    seguiría recorriendo el flujo entero con el lead pausado."""
    session = AsyncMock()
    session.execute = AsyncMock(side_effect=[
        _ClaimResult([42]), _ClaimResult([]), SimpleNamespace(),
    ])
    monkeypatch.setattr(automation_service, "get_sessionmaker", _sessionmaker(session))
    run_execution = AsyncMock()
    monkeypatch.setattr(automation_service, "_run_execution", run_execution)
    broadcast = AsyncMock()
    monkeypatch.setattr(automation_service, "manager", SimpleNamespace(broadcast=broadcast))

    processed = await automation_service.process_due_automation_executions(limit=5)

    assert processed == 0
    run_execution.assert_not_awaited()
    freeze_sql = _compile(session.execute.await_args_list[0].args[0])
    assert "'paused'" in freeze_sql
    assert "automatizacion_pausada" in freeze_sql
    # Un flujo manual del vendedor nunca lo congela la pausa del lead.
    assert "start_source != 'manual'" in freeze_sql
    broadcast.assert_awaited_once()


@pytest.mark.asyncio
async def test_reviving_a_stale_execution_increments_attempts(monkeypatch):
    session = AsyncMock()

    class _ExhaustedResult:
        def scalars(self):
            return self

        def all(self):
            return []

    session.execute = AsyncMock(side_effect=[_ExhaustedResult(), SimpleNamespace()])
    monkeypatch.setattr(automation_service, "get_sessionmaker", _sessionmaker(session))

    await automation_service._release_stale_executions()

    revive_sql = _compile(session.execute.await_args_list[1].args[0])
    assert "attempts=(automation_executions.attempts + 1)" in revive_sql
    assert "'scheduled'" in revive_sql


@pytest.mark.asyncio
async def test_retrying_an_execution_resets_attempts(monkeypatch):
    execution = SimpleNamespace(
        id=5, status=AutomationExecutionStatus.FAILED, rule_id=1, attempts=6,
    )
    rule = SimpleNamespace(id=1, deleted_at=None, is_active=True)
    session = AsyncMock()
    session.get = AsyncMock(side_effect=[execution, rule])
    session.execute = AsyncMock(return_value=SimpleNamespace(rowcount=1))
    monkeypatch.setattr(automation_service, "get_sessionmaker", _sessionmaker(session))
    monkeypatch.setattr(automation_service, "manager", SimpleNamespace(broadcast=AsyncMock()))
    monkeypatch.setattr(
        automation_service, "get_automation_execution", AsyncMock(return_value={"id": 5}),
    )

    result = await automation_service.retry_automation_execution(5)

    assert result == {"id": 5}
    update_sql = _compile(session.execute.await_args.args[0])
    assert "attempts=0" in update_sql

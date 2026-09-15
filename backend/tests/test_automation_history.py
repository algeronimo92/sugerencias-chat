"""Filtros del historial de automatizaciones sin depender de PostgreSQL."""

from datetime import date

import pytest
from sqlalchemy.dialects import postgresql

from domain_types import AutomationExecutionStatus
from services import automation_service
from tests.conftest import patch_automations


async def _history_sql(monkeypatch, **filters) -> str:
    statements = []

    class FakeResult:
        def mappings(self):
            return self

        def all(self):
            return []

    class FakeSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def execute(self, statement):
            statements.append(statement)
            return FakeResult()

    patch_automations(monkeypatch, "get_sessionmaker", lambda: FakeSession)
    await automation_service.list_automation_executions(**filters)
    return str(statements[0].compile(
        dialect=postgresql.dialect(),
        compile_kwargs={"literal_binds": True},
    ))


@pytest.mark.asyncio
async def test_history_can_exclude_skipped_before_limit(monkeypatch):
    sql = await _history_sql(monkeypatch, exclude_skipped=True, limit=200)

    assert "automation_executions.status != 'skipped'" in sql
    assert "LIMIT 200" in sql


@pytest.mark.asyncio
async def test_explicit_skipped_filter_takes_precedence(monkeypatch):
    sql = await _history_sql(
        monkeypatch,
        status=AutomationExecutionStatus.SKIPPED,
        exclude_skipped=True,
    )

    assert "automation_executions.status = 'skipped'" in sql
    assert "automation_executions.status != 'skipped'" not in sql


@pytest.mark.asyncio
async def test_history_joins_execution_initiator(monkeypatch):
    sql = await _history_sql(monkeypatch)

    assert "users.name AS started_by_name" in sql
    assert "users.id = automation_executions.started_by_user_id" in sql


@pytest.mark.asyncio
async def test_history_filters_by_date_range(monkeypatch):
    # America/Lima es UTC-5 todo el año: medianoche local del 11 y del 12 de
    # septiembre caen en 05:00 UTC de cada día.
    sql = await _history_sql(monkeypatch, date_from=date(2026, 9, 11), date_to=date(2026, 9, 11))

    assert "automation_executions.created_at >= '2026-09-11 05:00:00" in sql
    assert "automation_executions.created_at < '2026-09-12 05:00:00" in sql


@pytest.mark.asyncio
async def test_active_true_filters_non_terminal_statuses(monkeypatch):
    sql = await _history_sql(monkeypatch, active=True)

    assert "automation_executions.status IN ('scheduled', 'running', 'paused')" in sql or (
        "automation_executions.status IN (" in sql
        and all(value in sql for value in ("'scheduled'", "'running'", "'paused'"))
    )


@pytest.mark.asyncio
async def test_active_false_filters_terminal_statuses(monkeypatch):
    sql = await _history_sql(monkeypatch, active=False)

    assert "automation_executions.status NOT IN (" in sql
    assert all(value in sql for value in ("'scheduled'", "'running'", "'paused'"))


@pytest.mark.asyncio
async def test_explicit_status_takes_precedence_over_active(monkeypatch):
    sql = await _history_sql(monkeypatch, status=AutomationExecutionStatus.COMPLETED, active=True)

    assert "automation_executions.status = 'completed'" in sql
    assert "automation_executions.status IN (" not in sql


@pytest.mark.asyncio
async def test_history_filters_by_started_by_user_id(monkeypatch):
    # Es lo que acota "Flujos enviados" a las ejecuciones que un vendedor
    # disparó él mismo, sin exponerle el historial completo de otros leads.
    sql = await _history_sql(monkeypatch, started_by_user_id=42)

    assert "automation_executions.started_by_user_id = 42" in sql

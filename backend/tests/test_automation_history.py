"""Filtros del historial de automatizaciones sin depender de PostgreSQL."""

import pytest
from sqlalchemy.dialects import postgresql

from domain_types import AutomationExecutionStatus
from services import automation_service


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

    monkeypatch.setattr(automation_service, "get_sessionmaker", lambda: FakeSession)
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

"""Una ejecución que arrancó otro flujo dice quién la llamó.

El chat muestra los flujos que pasaron por un lead; si un flujo hijo solo
dijera su propio nombre, "Ubicacion" parecería un disparo manual cuando en
realidad lo llamó "Hollywood peel". El padre ya viajaba en event_payload
(domain/execution.py::child_flow_payload); acá se expone y se resuelve su
nombre en la misma consulta.
"""

from contextlib import asynccontextmanager

import pytest
from sqlalchemy.dialects import postgresql

from app.modules.automations import queries


async def _history_sql(monkeypatch) -> str:
    statements = []

    class FakeResult:
        def mappings(self):
            return self

        def all(self):
            return []

    class FakeSession:
        async def execute(self, statement):
            statements.append(statement)
            return FakeResult()

    @asynccontextmanager
    async def session_scope():
        yield FakeSession()

    monkeypatch.setattr(queries, "session_scope", session_scope)
    await queries.list_automation_executions(lead_id="00000000-0000-0000-0000-000000000001")
    return str(statements[0].compile(
        dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True},
    ))


@pytest.mark.asyncio
async def test_history_joins_the_parent_rule_through_the_event_payload(monkeypatch):
    sql = await _history_sql(monkeypatch)

    assert "parent_rule_name" in sql
    assert "automation_executions.event_payload" in sql
    assert "parent_rule_id" in sql


def _row(**overrides) -> dict:
    base = {
        "id": 2, "rule_id": 8, "rule_name": "Ubicacion", "rule_deleted": False,
        "event_payload": None, "parent_rule_name": None,
        "lead_id": "lead-1", "lead_name": "Jose", "trigger_type": "manual", "status": "completed",
        "scheduled_for": None, "paused_at": None, "pause_scope": None, "started_at": None,
        "finished_at": None, "action_results": [], "flow_state": {}, "error": None, "error_code": None,
        "created_at": None, "start_source": "flow", "started_by_user_id": None, "started_by_name": None,
        "window_override_at": None, "window_override_by_name": None,
    }
    return {**base, **overrides}


def test_a_child_execution_exposes_its_parent():
    item = queries._execution_dict(_row(
        event_payload={"parent_execution_id": 1, "parent_rule_id": 1, "flow_ancestry": [1]},
        parent_rule_name="Hollywood peel",
    ))

    assert item["parent_execution_id"] == 1
    assert item["parent_rule_id"] == 1
    assert item["parent_rule_name"] == "Hollywood peel"


def test_an_execution_without_parent_has_no_parent_fields():
    item = queries._execution_dict(_row(start_source="manual"))

    assert item["parent_execution_id"] is None
    assert item["parent_rule_id"] is None
    assert item["parent_rule_name"] is None

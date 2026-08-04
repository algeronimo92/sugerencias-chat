"""Cancelar una ejecución debe frenarla de verdad — antes, el próximo paso
del motor pisaba el skipped de la cancelación y el flujo seguía mandando
mensajes indefinidamente. Cubre la guarda de estado en cancel/retry y el
corte del bucle en _run_execution/_run_visual_execution."""

import dataclasses
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from domain_types import AutomationExecutionStatus
from services import automation_service
from services.automation_service import _run_execution, _run_visual_execution, _save_execution
from tests.conftest import make_chat, make_execution, make_rule


class _SessionContext:
    def __init__(self, session):
        self._session = session

    async def __aenter__(self):
        return self._session

    async def __aexit__(self, *_args):
        return False


def _sessionmaker(session):
    return lambda: (lambda: _SessionContext(session))


def two_actions_flow():
    return {
        "conditions": {},
        "nodes": [
            {"id": "t", "type": "trigger", "position": {"x": 0, "y": 0}, "data": {"trigger_type": "manual"}},
            {"id": "a1", "type": "action", "position": {"x": 0, "y": 0}, "data": {
                "action": {"type": "add_tag", "tag_id": 1},
            }},
            {"id": "a2", "type": "action", "position": {"x": 0, "y": 0}, "data": {
                "action": {"type": "add_tag", "tag_id": 2},
            }},
            {"id": "e1", "type": "end", "position": {"x": 0, "y": 0}, "data": {"label": "Fin"}},
        ],
        "edges": [
            {"id": "1", "source": "t", "target": "a1", "source_handle": "next"},
            {"id": "2", "source": "a1", "target": "a2", "source_handle": "next"},
            {"id": "3", "source": "a2", "target": "e1", "source_handle": "next"},
        ],
    }


def _sequential_session(rowcounts):
    """FakeSession que devuelve un rowcount distinto en cada UPDATE, en orden
    — simula que un cancel_automation_execution concurrente ganó la carrera
    justo entre dos persistencias del motor."""
    calls: list[dict] = []
    state = {"n": 0}

    class FakeSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def execute(self, stmt):
            calls.append(stmt.compile().params)
            rowcount = rowcounts[state["n"]]
            state["n"] += 1
            return SimpleNamespace(rowcount=rowcount)

        async def commit(self):
            pass

    return FakeSession, calls


@pytest.mark.asyncio
async def test_cancel_returns_none_when_already_in_a_final_state(monkeypatch):
    session = AsyncMock()
    session.execute = AsyncMock(return_value=SimpleNamespace(rowcount=0))
    monkeypatch.setattr(automation_service, "get_sessionmaker", _sessionmaker(session))
    broadcast = AsyncMock()
    monkeypatch.setattr(automation_service, "manager", SimpleNamespace(broadcast=broadcast))

    result = await automation_service.cancel_automation_execution(5)

    assert result is None
    broadcast.assert_not_awaited()


@pytest.mark.asyncio
async def test_cancel_broadcasts_and_returns_execution_when_applied(monkeypatch):
    session = AsyncMock()
    session.execute = AsyncMock(return_value=SimpleNamespace(rowcount=1))
    monkeypatch.setattr(automation_service, "get_sessionmaker", _sessionmaker(session))
    broadcast = AsyncMock()
    monkeypatch.setattr(automation_service, "manager", SimpleNamespace(broadcast=broadcast))
    monkeypatch.setattr(
        automation_service, "get_automation_execution", AsyncMock(return_value={"id": 5}),
    )

    result = await automation_service.cancel_automation_execution(5)

    assert result == {"id": 5}
    broadcast.assert_awaited_once()


@pytest.mark.asyncio
async def test_retry_returns_none_when_execution_already_moved_on(monkeypatch):
    """Dos admins reintentan la misma ejecución a la vez: solo uno debe ganar."""
    execution = SimpleNamespace(
        id=5, status=AutomationExecutionStatus.FAILED, rule_id=1, attempts=2,
    )
    rule = SimpleNamespace(id=1, deleted_at=None, is_active=True)
    session = AsyncMock()
    session.get = AsyncMock(side_effect=[execution, rule])
    session.execute = AsyncMock(return_value=SimpleNamespace(rowcount=0))
    monkeypatch.setattr(automation_service, "get_sessionmaker", _sessionmaker(session))
    broadcast = AsyncMock()
    monkeypatch.setattr(automation_service, "manager", SimpleNamespace(broadcast=broadcast))

    result = await automation_service.retry_automation_execution(5)

    assert result is None
    broadcast.assert_not_awaited()


class TestSaveExecution:
    async def test_returns_false_when_row_already_skipped(self, deps):
        class FakeSession:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *exc):
                return False

            async def execute(self, stmt):
                return SimpleNamespace(rowcount=0)

            async def commit(self):
                pass

        saved = await _save_execution(
            1, dataclasses.replace(deps, session_factory=lambda: FakeSession),
            status=AutomationExecutionStatus.RUNNING,
        )

        assert saved is False

    async def test_returns_true_when_applied(self, deps):
        class FakeSession:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *exc):
                return False

            async def execute(self, stmt):
                return SimpleNamespace(rowcount=1)

            async def commit(self):
                pass

        saved = await _save_execution(
            1, dataclasses.replace(deps, session_factory=lambda: FakeSession),
            status=AutomationExecutionStatus.RUNNING,
        )

        assert saved is True


class TestRunExecutionStopsAfterCancellation:
    async def test_does_not_run_the_third_action_once_save_execution_reports_cancelled(
        self, monkeypatch, deps,
    ):
        execution = SimpleNamespace(
            id=1, rule_id=1, lead_id="51999@s.whatsapp.net", action_results=[],
            event_payload={}, flow_state={},
        )
        rule = make_rule(
            builder_mode="simple", max_executions_per_hour=None,
            actions=[
                {"type": "add_tag", "tag_id": 1},
                {"type": "add_tag", "tag_id": 2},
                {"type": "add_tag", "tag_id": 3},
            ],
        )

        class FakeSession:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *exc):
                return False

            async def get(self, model, pk):
                name = getattr(model, "__name__", "")
                return execution if name == "AutomationExecution" else rule

        test_deps = dataclasses.replace(
            deps,
            session_factory=lambda: FakeSession,
            fetch_chat=AsyncMock(return_value=make_chat()),
        )

        execute_action = AsyncMock(return_value={"status": AutomationExecutionStatus.COMPLETED})
        monkeypatch.setattr(automation_service, "_execute_action", execute_action)
        monkeypatch.setattr(
            automation_service, "_save_execution", AsyncMock(side_effect=[True, False]),
        )

        await _run_execution(1, test_deps)

        assert execute_action.await_count == 2


class TestRunVisualExecutionStopsAfterCancellation:
    async def test_does_not_run_the_second_action_node_once_persist_reports_cancelled(
        self, deps, recorder,
    ):
        FakeSession, calls = _sequential_session([1, 0])
        execution = make_execution(flow_state={"definition": two_actions_flow(), "flow_version": 0})
        rule = make_rule(builder_mode="visual", flow_version=0)

        await _run_visual_execution(
            execution, rule, make_chat(),
            dataclasses.replace(deps, session_factory=lambda: FakeSession),
        )

        assert recorder.tags_added == [(make_chat()["chat_id"], 1)]
        assert len(calls) == 2

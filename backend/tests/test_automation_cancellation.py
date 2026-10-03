"""Cancelar una ejecución debe frenarla de verdad — antes, el próximo paso
del motor pisaba el skipped de la cancelación y el flujo seguía mandando
mensajes indefinidamente. Cubre la guarda de estado en cancel/retry y el
corte del bucle en run_execution/run_visual_execution."""

import dataclasses
from unittest.mock import AsyncMock

from domain_types import AutomationExecutionStatus
from app.modules.automations.application.engine import run_execution, run_visual_execution, save_execution
from app.modules.automations.application.management import cancel_automation_execution, retry_automation_execution
from app.modules.automations.domain.events import AutomationsChanged
from tests.automation_fakes import execution as stored_execution, rule as stored_rule
from tests.conftest import make_chat, make_execution, make_rule


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


async def test_cancel_returns_none_when_already_in_a_final_state(in_memory_automations):
    in_memory_automations.executions.add(stored_execution(id=5, status=AutomationExecutionStatus.COMPLETED))

    result = await cancel_automation_execution(5)

    assert result is None
    assert in_memory_automations.published == []


async def test_cancel_announces_and_returns_execution_when_applied(in_memory_automations):
    in_memory_automations.executions.add(stored_execution(id=5, status=AutomationExecutionStatus.SCHEDULED))

    result = await cancel_automation_execution(5)

    assert result == {"id": 5, "status": AutomationExecutionStatus.SKIPPED}
    assert in_memory_automations.of(AutomationsChanged) == [AutomationsChanged()]


async def test_retry_returns_none_when_execution_already_moved_on(in_memory_automations):
    """Dos admins reintentan la misma ejecución a la vez: solo uno debe ganar."""
    store = in_memory_automations.executions
    store.add(stored_execution(id=5, status=AutomationExecutionStatus.FAILED), stored_rule())
    store.requeue = AsyncMock(return_value=False)

    result = await retry_automation_execution(5)

    assert result is None
    assert in_memory_automations.published == []


class TestSaveExecution:
    async def test_returns_false_when_row_already_skipped(self, deps, executions):
        executions.add(stored_execution(id=1, status=AutomationExecutionStatus.SKIPPED))

        saved = await save_execution(1, deps, status=AutomationExecutionStatus.RUNNING)

        assert saved is False

    async def test_returns_true_when_applied(self, deps, executions):
        executions.add(stored_execution(id=1, status=AutomationExecutionStatus.RUNNING))

        saved = await save_execution(1, deps, status=AutomationExecutionStatus.RUNNING)

        assert saved is True

    async def test_a_terminal_status_stamps_finished_at(self, deps, executions, frozen_now):
        executions.add(stored_execution(id=1, status=AutomationExecutionStatus.RUNNING))

        await save_execution(1, deps, status=AutomationExecutionStatus.COMPLETED)

        assert executions.executions[1].finished_at == frozen_now


class TestRunExecutionStopsAfterCancellation:
    async def test_does_not_run_the_third_action_once_save_execution_reports_cancelled(
        self, deps, executions, recorder,
    ):
        executions.add(stored_execution(id=1), make_rule(
            builder_mode="simple", max_executions_per_hour=None,
            actions=[
                {"type": "add_tag", "tag_id": 1},
                {"type": "add_tag", "tag_id": 2},
                {"type": "add_tag", "tag_id": 3},
            ],
        ))
        executions.save = AsyncMock(side_effect=[True, False])
        deps = dataclasses.replace(deps, fetch_chat=AsyncMock(return_value=make_chat()))

        await run_execution(1, deps)

        assert [tag for _chat, tag in recorder.tags_added] == [1, 2]


class TestRunVisualExecutionStopsAfterCancellation:
    async def test_does_not_run_the_second_action_node_once_persist_reports_cancelled(
        self, deps, executions, recorder,
    ):
        executions.save = AsyncMock(side_effect=[True, False])
        execution = make_execution(flow_state={"definition": two_actions_flow(), "flow_version": 0})
        rule = make_rule(builder_mode="visual", flow_version=0)

        await run_visual_execution(execution, rule, make_chat(), deps)

        assert recorder.tags_added == [(make_chat()["chat_id"], 1)]
        assert executions.save.await_count == 2

"""Invocar un flujo desde otro: la validación al publicar y la ejecución
hija que agenda el motor."""

from types import SimpleNamespace

import pytest

from domain_types import AutomationBuilderMode, AutomationTrigger, FlowNodeType
from app.modules.automations.application.flow_nodes import start_invoked_flow
from app.modules.automations.domain.events import AutomationsChanged
from app.modules.automations.domain.flow_definition import check_invoked_flows, invoked_flow_ids
from tests.automation_fakes import rule as stored_rule


def definition(*target_ids: int) -> dict:
    return {
        "nodes": [
            {"id": f"call-{target_id}", "type": FlowNodeType.INVOKE_FLOW, "data": {"flow_rule_id": target_id}}
            for target_id in target_ids
        ]
    }


class TestInvocationValidation:
    def test_extracts_only_valid_invoked_rule_ids(self):
        assert invoked_flow_ids(definition(2, 3)) == {2, 3}

    def test_rejects_direct_self_invocation(self):
        rules = {1: {"name": "Padre", "builder_mode": AutomationBuilderMode.VISUAL, "published_flow_definition": definition()}}
        with pytest.raises(ValueError, match="sí mismo"):
            check_invoked_flows(rules, {1}, 1, definition(1))

    def test_rejects_indirect_cycle(self):
        rules = {
            1: {"name": "A", "builder_mode": AutomationBuilderMode.VISUAL, "published_flow_definition": definition()},
            2: {"name": "B", "builder_mode": AutomationBuilderMode.VISUAL, "published_flow_definition": definition(1)},
        }
        with pytest.raises(ValueError, match="ciclo"):
            check_invoked_flows(rules, {2}, 1, definition(2))

    def test_rejects_an_unpublished_child(self):
        rules = {2: {"name": "B", "builder_mode": AutomationBuilderMode.VISUAL, "published_flow_definition": None}}
        with pytest.raises(ValueError, match="Publica el flujo hijo B"):
            check_invoked_flows(rules, {2}, 1, definition(2))


def _target(**overrides):
    return stored_rule(**{
        "id": 9, "name": "Hollywood Peel", "builder_mode": AutomationBuilderMode.VISUAL,
        "published_flow_definition": definition(), "trigger_type": AutomationTrigger.MANUAL,
        "flow_version": 4, **overrides,
    })


class TestStartInvokedFlow:
    async def test_creates_an_auditable_child_execution(self, deps, executions, recorder):
        executions.rules[9] = _target()
        parent = SimpleNamespace(
            id=100,
            rule_id=1,
            lead_id="4316bc30-f78c-57a2-8f98-bff9087678d6",
            event_payload={"message_id": "WA-1", "content": "Hollywood Peel"},
            flow_state={},
            started_by_user_id=7,
        )

        child_id, name = await start_invoked_flow(parent, 9, "call-1", deps)

        [child] = executions.children
        assert (child_id, name) == (child["id"], "Hollywood Peel")
        assert child["event_key"] == "flow:100:call-1"
        assert child["lead_id"] == parent.lead_id
        assert child["started_by_user_id"] == 7
        assert child["event_payload"]["parent_execution_id"] == parent.id
        assert child["event_payload"]["content"] == "Hollywood Peel"
        assert recorder.of(AutomationsChanged) == [AutomationsChanged(wake=True)]

    async def test_reuses_the_child_after_a_retry_instead_of_duplicating_it(self, deps, executions):
        executions.rules[9] = _target()
        parent = SimpleNamespace(
            id=100, rule_id=1, lead_id="4316bc30-f78c-57a2-8f98-bff9087678d6",
            event_payload={}, flow_state={}, started_by_user_id=None,
        )

        first, _ = await start_invoked_flow(parent, 9, "call-1", deps)
        again, _ = await start_invoked_flow(parent, 9, "call-1", deps)

        assert first == again
        assert len(executions.children) == 1

    @pytest.mark.parametrize(("overrides", "message"), [
        ({"deleted_at": "ayer"}, "ya no existe"),
        ({"builder_mode": AutomationBuilderMode.SIMPLE}, "ya no es un flujo visual"),
        ({"is_active": False}, "no está publicado y activo"),
    ])
    async def test_a_child_that_changed_since_publishing_is_refused(self, deps, executions, overrides, message):
        executions.rules[9] = _target(**overrides)
        parent = SimpleNamespace(id=100, rule_id=1, lead_id="x", event_payload={}, flow_state={}, started_by_user_id=None)

        with pytest.raises(ValueError, match=message):
            await start_invoked_flow(parent, 9, "call-1", deps)
        assert executions.children == []

    async def test_runtime_ancestry_stops_legacy_cycles(self, deps):
        parent = SimpleNamespace(
            id=100, rule_id=2, lead_id="4316bc30-f78c-57a2-8f98-bff9087678d6",
            event_payload={"flow_ancestry": [1]}, flow_state={}, started_by_user_id=None,
        )
        with pytest.raises(ValueError, match="ciclo"):
            await start_invoked_flow(parent, 1, "call-1", deps)

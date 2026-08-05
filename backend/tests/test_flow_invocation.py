from dataclasses import replace
from types import SimpleNamespace

import pytest

from domain_types import AutomationBuilderMode, AutomationTrigger, FlowNodeType
from services.automation_service import (
    _invoked_flow_ids,
    _start_invoked_flow,
    _validate_invoked_flows,
)


def definition(*target_ids: int) -> dict:
    return {
        "nodes": [
            {"id": f"call-{target_id}", "type": FlowNodeType.INVOKE_FLOW, "data": {"flow_rule_id": target_id}}
            for target_id in target_ids
        ]
    }


class MappingResult:
    def __init__(self, rows):
        self.rows = rows

    def mappings(self):
        return self

    def all(self):
        return self.rows


class RulesSession:
    def __init__(self, rows):
        self.rows = rows

    async def execute(self, stmt):
        return MappingResult(self.rows)


class TestInvocationValidation:
    def test_extracts_only_valid_invoked_rule_ids(self):
        assert _invoked_flow_ids(definition(2, 3)) == {2, 3}

    async def test_rejects_direct_self_invocation(self):
        rows = [{
            "id": 1,
            "name": "Padre",
            "builder_mode": AutomationBuilderMode.VISUAL,
            "published_flow_definition": definition(),
        }]
        with pytest.raises(ValueError, match="sí mismo"):
            await _validate_invoked_flows(RulesSession(rows), {1}, 1, definition(1))

    async def test_rejects_indirect_cycle(self):
        rows = [
            {
                "id": 1, "name": "A", "builder_mode": AutomationBuilderMode.VISUAL,
                "published_flow_definition": definition(),
            },
            {
                "id": 2, "name": "B", "builder_mode": AutomationBuilderMode.VISUAL,
                "published_flow_definition": definition(1),
            },
        ]
        with pytest.raises(ValueError, match="ciclo"):
            await _validate_invoked_flows(RulesSession(rows), {2}, 1, definition(2))


class InsertResult:
    def __init__(self, child_id):
        self.child_id = child_id

    def scalar_one_or_none(self):
        return self.child_id


class ChildSession:
    def __init__(self, target, inserted_id=321, existing_id=None):
        self.target = target
        self.inserted_id = inserted_id
        self.existing_id = existing_id
        self.committed = False
        self.insert_params = None

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def get(self, model, pk):
        return self.target if pk == self.target.id else None

    async def execute(self, stmt):
        self.insert_params = stmt.compile().params
        return InsertResult(self.inserted_id)

    async def scalar(self, stmt):
        return self.existing_id

    async def commit(self):
        self.committed = True


class TestStartInvokedFlow:
    async def test_creates_an_auditable_child_execution(self, deps, recorder):
        target = SimpleNamespace(
            id=9,
            name="Hollywood Peel",
            deleted_at=None,
            builder_mode=AutomationBuilderMode.VISUAL,
            is_active=True,
            published_flow_definition=definition(),
            trigger_type=AutomationTrigger.MANUAL,
            flow_version=4,
        )
        session = ChildSession(target)
        child_deps = replace(deps, session_factory=lambda: lambda: session)
        parent = SimpleNamespace(
            id=100,
            rule_id=1,
            lead_id="51999@s.whatsapp.net",
            event_payload={"message_id": "WA-1", "content": "Hollywood Peel"},
            flow_state={},
            started_by_user_id=7,
        )

        child_id, name = await _start_invoked_flow(parent, 9, "call-1", child_deps)

        assert (child_id, name) == (321, "Hollywood Peel")
        assert session.committed is True
        assert session.insert_params["start_source"] == "flow"
        assert session.insert_params["lead_id"] == parent.lead_id
        assert session.insert_params["event_payload"]["parent_execution_id"] == parent.id
        assert session.insert_params["event_payload"]["content"] == "Hollywood Peel"
        assert recorder.broadcasts[-1]["type"] == "automations_updated"

    async def test_reuses_the_child_after_a_retry_instead_of_duplicating_it(self, deps):
        target = SimpleNamespace(
            id=9,
            name="Hollywood Peel",
            deleted_at=None,
            builder_mode=AutomationBuilderMode.VISUAL,
            is_active=True,
            published_flow_definition=definition(),
            trigger_type=AutomationTrigger.MANUAL,
            flow_version=4,
        )
        session = ChildSession(target, inserted_id=None, existing_id=777)
        child_deps = replace(deps, session_factory=lambda: lambda: session)
        parent = SimpleNamespace(
            id=100, rule_id=1, lead_id="51999@s.whatsapp.net",
            event_payload={}, flow_state={}, started_by_user_id=None,
        )

        child_id, _ = await _start_invoked_flow(parent, 9, "call-1", child_deps)

        assert child_id == 777

    async def test_runtime_ancestry_stops_legacy_cycles(self, deps):
        parent = SimpleNamespace(
            id=100, rule_id=2, lead_id="51999@s.whatsapp.net",
            event_payload={"flow_ancestry": [1]}, flow_state={}, started_by_user_id=None,
        )
        with pytest.raises(ValueError, match="ciclo"):
            await _start_invoked_flow(parent, 1, "call-1", deps)

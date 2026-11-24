"""Invocar un flujo desde otro: la validación al publicar y la ejecución
hija que agenda el motor."""

from datetime import timedelta
from types import SimpleNamespace

import pytest

from app.modules.automations.ports.types import AutomationTrigger, FlowNodeType
from app.modules.automations.application.flow_nodes import already_started_for_lead, start_invoked_flow
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
        rules = {1: {"name": "Padre", "published_flow_definition": definition()}}
        with pytest.raises(ValueError, match="sí misma"):
            check_invoked_flows(rules, {1}, 1, definition(1))

    def test_rejects_indirect_cycle(self):
        rules = {
            1: {"name": "A", "published_flow_definition": definition()},
            2: {"name": "B", "published_flow_definition": definition(1)},
        }
        with pytest.raises(ValueError, match="sin fin"):
            check_invoked_flows(rules, {2}, 1, definition(2))

    def test_rejects_an_unpublished_child(self):
        rules = {2: {"name": "B", "published_flow_definition": None}}
        with pytest.raises(ValueError, match="Publica primero «B»") as error:
            check_invoked_flows(rules, {2}, 1, definition(2))
        # El editor lleva al bloque que lo inicia, no solo muestra el texto.
        assert error.value.node_id == "call-2"


def _target(**overrides):
    return stored_rule(**{
        "id": 9, "name": "Hollywood Peel",
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
        ({"is_active": False}, "no está publicada y activa"),
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
        with pytest.raises(ValueError, match="sin fin"):
            await start_invoked_flow(parent, 1, "call-1", deps)


LEAD = "4316bc30-f78c-57a2-8f98-bff9087678d6"


def _parent():
    return SimpleNamespace(id=100, rule_id=1, lead_id=LEAD, event_payload={}, flow_state={}, started_by_user_id=None)


def _earlier(deps, **overrides):
    return SimpleNamespace(**{
        "id": 50, "rule_id": 9, "lead_id": LEAD, "event_key": "manual:abc", "status": "running",
        "start_source": "manual", "created_at": deps.now() - timedelta(seconds=10), **overrides,
    })


class TestInvokedFlowIsNotRepeated:
    """Incidente de noviembre de 2026: la vendedora lanzaba la secuencia en los
    15 s que «Bienvenida» espera y el cliente la recibía dos veces."""

    async def test_skips_the_flow_the_team_just_launched_from_the_chat(self, deps, executions):
        executions.rules[9] = _target()
        executions.executions[50] = _earlier(deps)

        reason = await already_started_for_lead(_parent(), 9, "call-1", deps)

        assert reason == "No se repitió «Hollywood Peel»: tu equipo ya la lanzó desde el chat hace menos de 30 minutos"

    async def test_says_so_when_another_flow_started_it(self, deps, executions):
        executions.rules[9] = _target()
        executions.executions[50] = _earlier(deps, start_source="flow", event_key="flow:7:n")

        reason = await already_started_for_lead(_parent(), 9, "call-1", deps)

        assert reason == "No se repitió «Hollywood Peel»: ya se le lanzó a este cliente hace menos de 30 minutos"

    @pytest.mark.parametrize("overrides", [
        {"created_at_minutes_ago": 31},
        {"status": "failed"},
        {"status": "cancelled"},
        {"status": "skipped"},
        {"lead_id": "otro-lead"},
        {"rule_id": 8},
        # El reintento del mismo bloque debe recuperar a su hija, no frenarse con ella.
        {"event_key": "flow:100:call-1", "start_source": "flow"},
    ])
    async def test_starts_it_when_nothing_was_sent_recently(self, deps, executions, overrides):
        executions.rules[9] = _target()
        minutes = overrides.pop("created_at_minutes_ago", None)
        if minutes:
            overrides["created_at"] = deps.now() - timedelta(minutes=minutes)
        executions.executions[50] = _earlier(deps, **overrides)

        assert await already_started_for_lead(_parent(), 9, "call-1", deps) is None

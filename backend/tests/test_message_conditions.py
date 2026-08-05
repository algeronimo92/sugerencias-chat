import dataclasses
from types import SimpleNamespace

import pytest

from domain_types import AutomationExecutionStatus, FlowConditionType
from services.automation_service import (
    _execution_message_context,
    _matches_flow_condition,
    _matches_flow_condition_node,
    _normalize_flow_condition,
    _normalize_flow_condition_node,
    _run_visual_execution,
    normalize_visual_draft,
)
from tests.conftest import make_chat, make_execution, make_rule


class TestNormalizeMessageCondition:
    @pytest.mark.parametrize("condition_type", [
        FlowConditionType.MESSAGE_CONTAINS,
        FlowConditionType.MESSAGE_EQUALS,
        FlowConditionType.MESSAGE_NOT_CONTAINS,
    ])
    def test_accepts_a_search_value(self, condition_type):
        normalized, user_id, tag_id = _normalize_flow_condition({
            "condition_type": condition_type,
            "value": "  Hollywood Peel  ",
        }, 2)
        assert normalized == {"condition_type": condition_type, "value": "Hollywood Peel"}
        assert user_id is None
        assert tag_id is None

    @pytest.mark.parametrize("value", ["", " ", "x" * 501])
    def test_rejects_blank_or_oversized_values(self, value):
        with pytest.raises(ValueError, match="500 caracteres"):
            _normalize_flow_condition({
                "condition_type": FlowConditionType.MESSAGE_CONTAINS,
                "value": value,
            }, 2)


class TestNormalizeConditionGroups:
    def test_converts_a_legacy_condition_to_one_group(self):
        normalized, users, tags = _normalize_flow_condition_node({
            "condition_type": FlowConditionType.MESSAGE_CONTAINS,
            "value": "Hollywood",
        }, 2)
        assert normalized["condition_groups"][0]["conditions"][0] == {
            "id": "condition_1",
            "condition_type": FlowConditionType.MESSAGE_CONTAINS,
            "value": "Hollywood",
        }
        assert users == set()
        assert tags == set()

    def test_normalizes_and_collects_references_from_all_groups(self):
        normalized, users, tags = _normalize_flow_condition_node({
            "condition_groups": [
                {"id": "hollywood", "conditions": [
                    {"id": "message", "condition_type": "message_contains", "value": "Hollywood"},
                    {"id": "seller", "condition_type": "seller_equals", "value": 7},
                ]},
                {"id": "campaign", "conditions": [
                    {"id": "tag", "condition_type": "tag_present", "value": 9},
                ]},
            ],
        }, 2)
        assert [group["id"] for group in normalized["condition_groups"]] == ["hollywood", "campaign"]
        assert users == {7}
        assert tags == {9}

    def test_rejects_empty_groups(self):
        with pytest.raises(ValueError, match="reglas AND"):
            _normalize_flow_condition_node({
                "condition_groups": [{"id": "empty", "conditions": []}],
            }, 2)

    def test_draft_accepts_dynamic_group_output_handles(self):
        definition = {
            "conditions": {},
            "nodes": [
                {"id": "t", "type": "trigger", "position": {}, "data": {"trigger_type": "message_received"}},
                {"id": "c", "type": "condition", "position": {}, "data": {
                    "condition_groups": [
                        {"id": "hollywood", "conditions": [
                            {"id": "h", "condition_type": "message_contains", "value": "Hollywood"},
                        ]},
                        {"id": "campaign", "conditions": [
                            {"id": "w", "condition_type": "message_contains", "value": "Semana"},
                        ]},
                    ],
                }},
                {"id": "e1", "type": "end", "position": {}, "data": {"label": "A"}},
                {"id": "e2", "type": "end", "position": {}, "data": {"label": "B"}},
                {"id": "e3", "type": "end", "position": {}, "data": {"label": "No"}},
            ],
            "edges": [
                {"id": "1", "source": "t", "target": "c", "source_handle": "next"},
                {"id": "2", "source": "c", "target": "e1", "source_handle": "hollywood"},
                {"id": "3", "source": "c", "target": "e2", "source_handle": "campaign"},
                {"id": "4", "source": "c", "target": "e3", "source_handle": "no"},
            ],
        }
        saved = normalize_visual_draft("Campañas", definition)
        assert [edge["source_handle"] for edge in saved["flow_definition"]["edges"]] == [
            "next", "hollywood", "campaign", "no",
        ]


class TestMatchMessageCondition:
    async def test_contains_ignores_case_accents_and_repeated_spaces(self, deps):
        matches, _ = await _matches_flow_condition(
            {"condition_type": FlowConditionType.MESSAGE_CONTAINS, "value": "Hollywood peel"},
            make_chat(),
            deps,
            "  QUIERO   HÓLLYWOOD PEEL, por favor ",
        )
        assert matches is True

    async def test_equals_uses_the_normalized_complete_message(self, deps):
        data = {"condition_type": FlowConditionType.MESSAGE_EQUALS, "value": "sí, deseo información"}
        assert (await _matches_flow_condition(data, make_chat(), deps, " SI,  deseo información "))[0] is True
        assert (await _matches_flow_condition(data, make_chat(), deps, "Sí, deseo información adicional"))[0] is False

    async def test_not_contains_inverts_the_contains_result(self, deps):
        data = {"condition_type": FlowConditionType.MESSAGE_NOT_CONTAINS, "value": "tatuaje"}
        assert (await _matches_flow_condition(data, make_chat(), deps, "Quiero HIFU"))[0] is True
        assert (await _matches_flow_condition(data, make_chat(), deps, "Borrado de tatuaje"))[0] is False

    @pytest.mark.parametrize("condition_type", [
        FlowConditionType.MESSAGE_CONTAINS,
        FlowConditionType.MESSAGE_EQUALS,
        FlowConditionType.MESSAGE_NOT_CONTAINS,
    ])
    async def test_missing_message_context_never_matches(self, deps, condition_type):
        matches, detail = await _matches_flow_condition(
            {"condition_type": condition_type, "value": "algo"}, make_chat(), deps, None,
        )
        assert matches is False
        assert "No hay" in detail


class TestMatchConditionGroups:
    GROUPED = {
        "condition_groups": [
            {"id": "hollywood", "conditions": [
                {"id": "h1", "condition_type": "message_contains", "value": "Hollywood"},
                {"id": "h2", "condition_type": "origin_contains", "value": "Facebook"},
            ]},
            {"id": "women_week", "conditions": [
                {"id": "w1", "condition_type": "message_contains", "value": "Semana de la mujer"},
            ]},
        ],
    }

    async def test_all_conditions_inside_a_group_must_match(self, deps):
        matches, branch, detail = await _matches_flow_condition_node(
            self.GROUPED, make_chat(origen="Instagram"), deps, "Quiero Hollywood",
        )
        assert matches is False
        assert branch == "no"
        assert "Ninguno" in detail

    async def test_groups_are_or_and_return_the_matching_output(self, deps):
        matches, branch, _ = await _matches_flow_condition_node(
            self.GROUPED, make_chat(origen="Instagram"), deps, "SEMANA DE LA MUJER",
        )
        assert matches is True
        assert branch == "women_week"

    async def test_first_matching_group_wins(self, deps):
        data = {"condition_groups": [
            {"id": "first", "conditions": [
                {"id": "a", "condition_type": "message_contains", "value": "Hollywood"},
            ]},
            {"id": "second", "conditions": [
                {"id": "b", "condition_type": "message_contains", "value": "Hollywood Peel"},
            ]},
        ]}
        assert (await _matches_flow_condition_node(
            data, make_chat(), deps, "Hollywood Peel",
        ))[1] == "first"


class TestMessageContext:
    def test_reply_that_resumed_the_flow_wins_over_trigger_message(self):
        execution = make_execution(
            event_payload={"message_id": "initial", "content": "mensaje inicial"},
            flow_state={"message_context": {"message_id": "reply", "content": "respuesta nueva"}},
        )
        assert _execution_message_context(execution) == {
            "message_id": "reply", "content": "respuesta nueva",
        }

    def test_non_text_reply_clears_the_previous_text_context(self):
        execution = make_execution(
            event_payload={"message_id": "initial", "content": "mensaje inicial"},
            flow_state={"message_context": {"message_id": "reply", "content": None}},
        )
        assert _execution_message_context(execution) == {
            "message_id": "reply", "content": None,
        }

    async def test_visual_condition_routes_using_trigger_message(self, deps):
        definition = {
            "conditions": {},
            "nodes": [
                {"id": "t", "type": "trigger", "data": {"trigger_type": "message_received"}},
                {"id": "c", "type": "condition", "data": {
                    "condition_type": "message_contains", "value": "Hollywood Peel",
                }},
                {"id": "yes", "type": "end", "data": {"label": "Coincide"}},
                {"id": "no", "type": "end", "data": {"label": "No coincide"}},
            ],
            "edges": [
                {"source": "t", "target": "c", "source_handle": "next"},
                {"source": "c", "target": "yes", "source_handle": "yes"},
                {"source": "c", "target": "no", "source_handle": "no"},
            ],
        }
        writes = []

        class FakeSession:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *exc):
                return False

            async def execute(self, stmt):
                writes.append(stmt.compile().params)
                return SimpleNamespace(rowcount=1)

            async def commit(self):
                pass

        execution = make_execution(
            event_payload={"message_id": "WA-1", "content": "Quiero HOLLYWOOD PEEL"},
            flow_state={"definition": definition, "flow_version": 0, "current_node_id": None, "path": []},
        )
        rule = make_rule(builder_mode="visual", flow_version=0)

        await _run_visual_execution(
            execution,
            rule,
            make_chat(),
            dataclasses.replace(deps, session_factory=lambda: FakeSession),
        )

        final = writes[-1]
        assert final["status"] == AutomationExecutionStatus.COMPLETED
        result = next(item for item in final["action_results"] if item["type"] == "condition")
        assert result["branch"] == "yes"

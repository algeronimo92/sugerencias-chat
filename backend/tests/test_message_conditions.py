from datetime import datetime, timezone

import pytest

from app.modules.automations.ports.types import AutomationExecutionStatus, FlowConditionType
from app.modules.automations.application.engine import run_visual_execution
from app.modules.automations.domain.conditions import match_condition_node, match_flow_condition
from app.modules.automations.domain.execution import execution_message_context
from app.modules.automations.domain.flow_definition import normalize_visual_draft
from app.modules.automations.domain.validation import normalize_flow_condition, normalize_flow_condition_node
from tests.conftest import make_chat, make_execution, make_rule

NOW = datetime(2026, 7, 20, 15, 0, tzinfo=timezone.utc)


def evaluate(data, chat, context):
    return match_flow_condition(data, chat, context, now=NOW)


def evaluate_node(data, chat, context):
    return match_condition_node(data, chat, context, now=NOW)


class TestNormalizeMessageCondition:
    @pytest.mark.parametrize("condition_type", [
        FlowConditionType.MESSAGE_CONTAINS,
        FlowConditionType.MESSAGE_EQUALS,
        FlowConditionType.MESSAGE_NOT_CONTAINS,
    ])
    def test_accepts_a_search_value(self, condition_type):
        normalized, user_id, tag_id = normalize_flow_condition({
            "condition_type": condition_type,
            "value": "  Hollywood Peel  ",
        }, 2)
        assert normalized == {"condition_type": condition_type, "value": "Hollywood Peel"}
        assert user_id is None
        assert tag_id is None

    @pytest.mark.parametrize("value", ["", " ", "x" * 501])
    def test_rejects_blank_or_oversized_values(self, value):
        with pytest.raises(ValueError, match="500 caracteres"):
            normalize_flow_condition({
                "condition_type": FlowConditionType.MESSAGE_CONTAINS,
                "value": value,
            }, 2)


class TestNormalizeConditionGroups:
    def test_converts_a_legacy_condition_to_one_group(self):
        normalized, users, tags = normalize_flow_condition_node({
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
        normalized, users, tags = normalize_flow_condition_node({
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
            normalize_flow_condition_node({
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
    def test_contains_ignores_case_accents_and_repeated_spaces(self):
        matches, _ = evaluate(
            {"condition_type": FlowConditionType.MESSAGE_CONTAINS, "value": "Hollywood peel"},
            make_chat(),
            {"content": "  QUIERO   HÓLLYWOOD PEEL, por favor "},
        )
        assert matches is True

    def test_equals_uses_the_normalized_complete_message(self):
        data = {"condition_type": FlowConditionType.MESSAGE_EQUALS, "value": "sí, deseo información"}
        assert (evaluate(data, make_chat(), {"content": " SI,  deseo información "}))[0] is True
        assert (evaluate(data, make_chat(), {"content": "Sí, deseo información adicional"}))[0] is False

    def test_not_contains_inverts_the_contains_result(self):
        data = {"condition_type": FlowConditionType.MESSAGE_NOT_CONTAINS, "value": "tatuaje"}
        assert (evaluate(data, make_chat(), {"content": "Quiero HIFU"}))[0] is True
        assert (evaluate(data, make_chat(), {"content": "Borrado de tatuaje"}))[0] is False

    @pytest.mark.parametrize("condition_type", [
        FlowConditionType.MESSAGE_CONTAINS,
        FlowConditionType.MESSAGE_EQUALS,
        FlowConditionType.MESSAGE_NOT_CONTAINS,
    ])
    async def test_missing_message_context_never_matches(self, condition_type):
        matches, detail = evaluate(
            {"condition_type": condition_type, "value": "algo"}, make_chat(), None,
        )
        assert matches is False
        assert "No hay" in detail


class TestMatchMediaAnalysisCondition:
    """Es lo que separa un comprobante de pago de una selfie de rostro: mira
    `analysis_summary` (la descripción que la IA generó del adjunto), no el
    texto que mandó el cliente."""

    def test_matches_when_the_ai_description_mentions_it(self):
        matches, detail = evaluate(
            {"condition_type": FlowConditionType.MEDIA_ANALYSIS_CONTAINS, "value": "comprobante de pago"},
            make_chat(),
            {"content": None, "analysis_summary": "La imagen es un COMPROBANTE DE PAGO de Yape por S/ 50.00"},
        )
        assert matches is True

    def test_does_not_match_a_different_description(self):
        matches, _ = evaluate(
            {"condition_type": FlowConditionType.MEDIA_ANALYSIS_CONTAINS, "value": "comprobante de pago"},
            make_chat(),
            {"content": None, "analysis_summary": "Primer plano del rostro de una persona, con pecas y ojeras"},
        )
        assert matches is False

    def test_a_plain_text_reply_never_matches_since_it_has_no_analysis(self):
        # Un texto no tiene analysis_summary: la rama Sí exige evidencia de
        # que era un adjunto, no ausencia de coincidencia en texto.
        matches, detail = evaluate(
            {"condition_type": FlowConditionType.MEDIA_ANALYSIS_CONTAINS, "value": "comprobante"},
            make_chat(),
            {"content": "ahorita te mando la captura", "analysis_summary": None},
        )
        assert matches is False
        assert "adjunto" in detail


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

    def test_all_conditions_inside_a_group_must_match(self):
        matches, branch, detail = evaluate_node(
            self.GROUPED, make_chat(origen="Instagram"), {"content": "Quiero Hollywood"},
        )
        assert matches is False
        assert branch == "no"
        assert "Ninguno" in detail

    def test_groups_are_or_and_return_the_matching_output(self):
        matches, branch, _ = evaluate_node(
            self.GROUPED, make_chat(origen="Instagram"), {"content": "SEMANA DE LA MUJER"},
        )
        assert matches is True
        assert branch == "women_week"

    def test_first_matching_group_wins(self):
        data = {"condition_groups": [
            {"id": "first", "conditions": [
                {"id": "a", "condition_type": "message_contains", "value": "Hollywood"},
            ]},
            {"id": "second", "conditions": [
                {"id": "b", "condition_type": "message_contains", "value": "Hollywood Peel"},
            ]},
        ]}
        assert (evaluate_node(
            data, make_chat(), {"content": "Hollywood Peel"},
        ))[1] == "first"


class TestMessageContext:
    def test_reply_that_resumed_the_flow_wins_over_trigger_message(self):
        execution = make_execution(
            event_payload={"message_id": "initial", "content": "mensaje inicial"},
            flow_state={"message_context": {"message_id": "reply", "content": "respuesta nueva"}},
        )
        assert execution_message_context(execution) == {
            "message_id": "reply", "content": "respuesta nueva",
            "message_type": None, "message_subtype": None, "reply_id": None, "analysis_summary": None,
        }

    def test_non_text_reply_clears_the_previous_text_context(self):
        execution = make_execution(
            event_payload={"message_id": "initial", "content": "mensaje inicial"},
            flow_state={"message_context": {"message_id": "reply", "content": None}},
        )
        assert execution_message_context(execution) == {
            "message_id": "reply", "content": None,
            "message_type": None, "message_subtype": None, "reply_id": None, "analysis_summary": None,
        }

    async def test_visual_condition_routes_using_trigger_message(self, deps, executions):
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
        execution = make_execution(
            event_payload={"message_id": "WA-1", "content": "Quiero HOLLYWOOD PEEL"},
            flow_state={"definition": definition, "flow_version": 0, "current_node_id": None, "path": []},
        )
        rule = make_rule(builder_mode="visual", flow_version=0)

        await run_visual_execution(execution, rule, make_chat(), deps)

        _execution_id, final = executions.saves[-1]
        assert final["status"] == AutomationExecutionStatus.COMPLETED
        result = next(item for item in final["action_results"] if item["type"] == "condition")
        assert result["branch"] == "yes"

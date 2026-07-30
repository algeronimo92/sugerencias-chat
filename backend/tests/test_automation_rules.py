"""Tests de la lógica del motor que no toca base de datos ni red."""

from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from domain_types import FlowHandle, FlowNodeType
from services.automation_rules import (
    is_business_hours,
    matches_static_conditions,
    normalize_conditions,
    normalize_edges,
    render_variables,
    unknown_variables,
    validate_graph_topology,
)

LIMA = ZoneInfo("America/Lima")


def node(node_id: str, node_type: str) -> dict:
    return {"id": node_id, "type": node_type, "data": {}}


def edge(source: str, target: str, handle: str = FlowHandle.NEXT) -> dict:
    return {"id": f"{source}->{target}:{handle}", "source": source, "target": target, "source_handle": handle}


def linear_flow() -> tuple[list[dict], list[dict]]:
    nodes = [
        node("t", FlowNodeType.TRIGGER),
        node("a", FlowNodeType.ACTION),
        node("e", FlowNodeType.END),
    ]
    edges = [edge("t", "a"), edge("a", "e")]
    return nodes, edges


class TestRenderVariables:
    def test_replaces_known_variables(self):
        chat = {"name": "Ana", "phone": "51999", "servicio_interes": "Botox", "vendedor": "Luis"}
        assert render_variables("Hola {{nombre}}, sobre {{servicio}}", chat) == "Hola Ana, sobre Botox"

    def test_missing_lead_fields_become_empty_not_none(self):
        assert render_variables("Hola {{nombre}}!", {}) == "Hola !"

    def test_unknown_variable_is_left_untouched(self):
        # Se deja crudo a propósito: borrarlo perdería información del mensaje.
        assert render_variables("Hola {{apellido}}", {"name": "Ana"}) == "Hola {{apellido}}"

    def test_uses_injected_clock_for_current_date(self):
        frozen = datetime(2026, 7, 20, 10, 0, tzinfo=LIMA)
        assert render_variables("{{fecha_actual}}", {}, now=frozen) == "20/07/2026"

    def test_detects_unknown_variables(self):
        assert unknown_variables("{{nombre}} y {{inventada}}") == {"inventada"}
        assert unknown_variables("{{nombre}} {{telefono}}") == set()


class TestBusinessHours:
    @pytest.mark.parametrize("hour,expected", [(7, False), (8, True), (17, True), (18, False)])
    def test_weekday_boundaries(self, hour, expected):
        # 2026-07-20 es lunes.
        assert is_business_hours(datetime(2026, 7, 20, hour, tzinfo=LIMA)) is expected

    def test_weekend_is_always_outside(self):
        saturday = datetime(2026, 7, 25, 10, tzinfo=LIMA)
        sunday = datetime(2026, 7, 26, 10, tzinfo=LIMA)
        assert not is_business_hours(saturday)
        assert not is_business_hours(sunday)


class TestNormalizeConditions:
    def test_blank_values_become_none(self):
        result = normalize_conditions({"stage": "  ", "origin_contains": "", "seller_id": 0})
        assert result["stage"] is None
        assert result["origin_contains"] is None
        assert result["seller_id"] is None

    def test_rejects_unknown_stage(self):
        with pytest.raises(ValueError, match="Etapa"):
            normalize_conditions({"stage": "etapa_inventada"})

    def test_cooldown_is_clamped_to_supported_range(self):
        assert normalize_conditions({"cooldown_minutes": 999999})["cooldown_minutes"] == 43200
        assert normalize_conditions({"cooldown_minutes": 0})["cooldown_minutes"] is None

    def test_non_dict_input_yields_empty_conditions(self):
        assert normalize_conditions(None)["stage"] is None


class TestMatchesStaticConditions:
    def test_empty_conditions_match_everything(self):
        assert matches_static_conditions({}, {"stage": "nuevo"}) == (True, None)

    def test_stage_mismatch_is_reported(self):
        matches, reason = matches_static_conditions({"stage": "oferta_presentada"}, {"stage": "nuevo"})
        assert matches is False
        assert "etapa" in reason.lower()

    def test_origin_match_is_case_insensitive(self):
        matches, _ = matches_static_conditions({"origin_contains": "facebook"}, {"origen": "FaceBook Ads"})
        assert matches is True

    def test_seller_mismatch_is_reported(self):
        matches, reason = matches_static_conditions({"seller_id": 2}, {"vendedor_id": 7})
        assert matches is False
        assert "vendedor" in reason.lower()

    def test_tag_presence_is_checked_against_assigned_tags(self):
        chat = {"tags": [{"id": 1}, {"id": 5}]}
        assert matches_static_conditions({"tag_id": 5}, chat)[0] is True
        assert matches_static_conditions({"tag_id": 9}, chat)[0] is False


class TestNormalizeEdges:
    def test_rejects_edge_pointing_to_unknown_node(self):
        with pytest.raises(ValueError, match="origen o destino"):
            normalize_edges([edge("t", "fantasma")], {"t", "a"})

    def test_rejects_self_loop(self):
        with pytest.raises(ValueError, match="origen o destino"):
            normalize_edges([edge("t", "t")], {"t"})

    def test_rejects_duplicate_edge_id(self):
        duplicated = [edge("t", "a"), edge("t", "a")]
        with pytest.raises(ValueError, match="duplicado"):
            normalize_edges(duplicated, {"t", "a"})

    def test_rejects_handle_outside_flowhandle_when_strict(self):
        with pytest.raises(ValueError, match="salida o identificador"):
            normalize_edges([edge("w", "e", "timer")], {"w", "e"}, allow_duplicate_handles=False)

    def test_accepts_extra_handles_when_provided(self):
        # Los handles dinámicos de un bloque wait_any ("timer"/"message") no
        # están en el enum fijo FlowHandle — extra_handles los admite.
        normalize_edges(
            [edge("w", "e", "timer")], {"w", "e"},
            allow_duplicate_handles=False, extra_handles={"timer"},
        )


class TestValidateGraphTopology:
    def test_accepts_linear_flow(self):
        nodes, edges = linear_flow()
        validate_graph_topology(nodes, edges, "t")

    def test_rejects_cycle(self):
        # Un ciclo haría que el motor recorriera bloques indefinidamente.
        nodes = [
            node("t", FlowNodeType.TRIGGER),
            node("a", FlowNodeType.ACTION),
            node("b", FlowNodeType.ACTION),
        ]
        edges = [edge("t", "a"), edge("a", "b"), edge("b", "a")]
        with pytest.raises(ValueError, match="ciclo"):
            validate_graph_topology(nodes, edges, "t")

    def test_rejects_unreachable_node(self):
        nodes, edges = linear_flow()
        nodes.append(node("huerfano", FlowNodeType.ACTION))
        edges.append(edge("huerfano", "e"))
        with pytest.raises(ValueError, match="conectados|alcanzables"):
            validate_graph_topology(nodes, edges, "t")

    def test_end_node_cannot_have_outgoing_edges(self):
        nodes, edges = linear_flow()
        nodes.append(node("extra", FlowNodeType.ACTION))
        edges.append(edge("e", "extra"))
        with pytest.raises(ValueError, match="Fin"):
            validate_graph_topology(nodes, edges, "t")

    def test_condition_requires_both_branches(self):
        nodes = [
            node("t", FlowNodeType.TRIGGER),
            node("c", FlowNodeType.CONDITION),
            node("e", FlowNodeType.END),
        ]
        edges = [edge("t", "c"), edge("c", "e", FlowHandle.YES)]
        with pytest.raises(ValueError, match="Sí y una salida No"):
            validate_graph_topology(nodes, edges, "t")

    def test_condition_with_both_branches_is_valid(self):
        nodes = [
            node("t", FlowNodeType.TRIGGER),
            node("c", FlowNodeType.CONDITION),
            node("si", FlowNodeType.END),
            node("no", FlowNodeType.END),
        ]
        edges = [
            edge("t", "c"),
            edge("c", "si", FlowHandle.YES),
            edge("c", "no", FlowHandle.NO),
        ]
        validate_graph_topology(nodes, edges, "t")

    def test_action_must_have_exactly_one_outgoing_edge(self):
        nodes, edges = linear_flow()
        edges.append(edge("a", "e", FlowHandle.YES))
        with pytest.raises(ValueError, match="exactamente una salida"):
            validate_graph_topology(nodes, edges, "t")

    def test_wait_any_requires_one_edge_per_condition(self):
        nodes = [
            node("t", FlowNodeType.TRIGGER),
            {"id": "w", "type": FlowNodeType.WAIT_ANY, "data": {"conditions": [
                {"id": "timer", "kind": "timer", "seconds": 10},
                {"id": "message", "kind": "message"},
            ]}},
            node("e1", FlowNodeType.END),
            node("e2", FlowNodeType.END),
        ]
        edges = [edge("t", "w"), edge("w", "e1", "timer")]
        with pytest.raises(ValueError, match="salida propia"):
            validate_graph_topology(nodes, edges, "t")
        edges.append(edge("w", "e2", "message"))
        validate_graph_topology(nodes, edges, "t")

    def test_wait_any_rejects_unknown_or_duplicate_handles(self):
        nodes = [
            node("t", FlowNodeType.TRIGGER),
            {"id": "w", "type": FlowNodeType.WAIT_ANY, "data": {"conditions": [
                {"id": "timer", "kind": "timer", "seconds": 10},
            ]}},
            node("e1", FlowNodeType.END),
            node("e2", FlowNodeType.END),
        ]
        # Dos salidas para una sola condición: no matchea el set esperado.
        edges = [edge("t", "w"), edge("w", "e1", "timer"), edge("w", "e2", "timer")]
        with pytest.raises(ValueError, match="salida propia"):
            validate_graph_topology(nodes, edges, "t")

    def test_wait_any_accepts_business_hours_and_media_played(self):
        nodes = [
            node("t", FlowNodeType.TRIGGER),
            {"id": "w", "type": FlowNodeType.WAIT_ANY, "data": {"conditions": [
                {"id": "timer", "kind": "timer", "seconds": 10},
                {"id": "business_hours", "kind": "business_hours"},
                {"id": "media_played", "kind": "media_played"},
            ]}},
            node("e1", FlowNodeType.END),
            node("e2", FlowNodeType.END),
            node("e3", FlowNodeType.END),
        ]
        edges = [
            edge("t", "w"), edge("w", "e1", "timer"),
            edge("w", "e2", "business_hours"), edge("w", "e3", "media_played"),
        ]
        validate_graph_topology(nodes, edges, "t")

    def test_question_requires_one_edge_per_button_plus_other_and_timeout(self):
        nodes = [
            node("t", FlowNodeType.TRIGGER),
            {"id": "q", "type": FlowNodeType.QUESTION, "data": {
                "text": "¿Todo bien?", "timeout_seconds": 60,
                "buttons": [{"id": "btn_1", "label": "Sí"}, {"id": "btn_2", "label": "No"}],
            }},
            node("e1", FlowNodeType.END),
            node("e2", FlowNodeType.END),
            node("e3", FlowNodeType.END),
            node("e4", FlowNodeType.END),
        ]
        edges = [edge("t", "q"), edge("q", "e1", "btn_1"), edge("q", "e2", "btn_2")]
        with pytest.raises(ValueError, match="propia salida"):
            validate_graph_topology(nodes, edges, "t")
        edges += [edge("q", "e3", "other"), edge("q", "e4", "timeout")]
        validate_graph_topology(nodes, edges, "t")

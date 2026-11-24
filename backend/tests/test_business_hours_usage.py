"""Qué automatizaciones preguntan por el horario de atención: lo muestra
Configuración para que cambiar el horario no sea a ciegas."""

import pytest

from app.modules.automations.domain.business_hours_usage import uses_business_hours


def flow(*nodes, conditions=None):
    return {"conditions": conditions or {}, "nodes": list(nodes), "edges": []}


def node(node_type, data):
    return {"id": "n", "type": node_type, "data": data}


@pytest.mark.parametrize(("conditions", "definition"), [
    # Regla simple con «solo en el horario de atención».
    ({"business_hours_only": True}, None),
    # La misma condición de entrada, guardada dentro del flujo.
    ({}, flow(conditions={"business_hours_only": True})),
    # Bloque Condición, con grupos y con la forma anterior a los grupos.
    ({}, flow(node("condition", {"condition_groups": [{"id": "g", "conditions": [{"condition_type": "business_hours"}]}]}))),
    ({}, flow(node("condition", {"condition_type": "business_hours"}))),
    # Rama «fuera del horario» de un bloque Pausa.
    ({}, flow(node("wait_any", {"conditions": [{"kind": "timer", "seconds": 60}, {"kind": "business_hours"}]}))),
])
def test_recognizes_each_place_where_a_rule_asks_for_the_schedule(conditions, definition):
    assert uses_business_hours(conditions, definition) is True


@pytest.mark.parametrize(("conditions", "definition"), [
    ({}, None),
    ({"business_hours_only": False, "require_open_window": True}, None),
    ({}, flow(node("condition", {"condition_groups": [{"id": "g", "conditions": [{"condition_type": "whatsapp_window_open"}]}]}))),
    ({}, flow(node("wait_any", {"conditions": [{"kind": "timer", "seconds": 60}]}))),
    ({}, flow(node("action", {"action": {"type": "send_message", "text": "horario business_hours"}}))),
    # Datos rotos no rompen la pantalla de Configuración.
    (None, {"nodes": "no es una lista"}),
    ({}, {"nodes": [None, {"type": "condition"}, {"type": "wait_any", "data": {"conditions": None}}]}),
])
def test_ignores_rules_that_do_not_ask(conditions, definition):
    assert uses_business_hours(conditions, definition) is False

"""Los errores de las automatizaciones son de dominio: la API no elige el
status por ruta."""

import pytest

from app.modules.automations.domain.errors import MALFORMED_INPUT, InvalidAutomation
from app.modules.automations.domain.flow_definition import normalize_flow


def _flow(action, *, with_end=True):
    nodes = [
        {"id": "t", "type": "trigger", "position": {"x": 0, "y": 0}, "data": {"trigger_type": "lead_created"}},
        {"id": "a", "type": "action", "position": {"x": 0, "y": 0}, "data": {"action": action}},
    ]
    if with_end:
        nodes.append({"id": "e", "type": "end", "position": {"x": 0, "y": 0}, "data": {"label": "Fin"}})
    return {"conditions": {}, "nodes": nodes, "edges": []}


def test_a_malformed_flow_is_an_invalid_input_not_a_server_error():
    with pytest.raises(InvalidAutomation) as caught:
        normalize_flow("x", _flow({"type": "add_tag", "tag_id": [1]}))

    assert caught.value.status_code == 400
    # El texto del TypeError describe el código, no el flujo.
    assert MALFORMED_INPUT in caught.value.detail


def test_a_rule_violation_keeps_its_message():
    with pytest.raises(InvalidAutomation) as caught:
        normalize_flow("x", _flow({"type": "add_tag", "tag_id": 1}, with_end=False))

    assert caught.value.status_code == 400
    assert "paso Fin" in caught.value.detail


def test_an_unexpected_failure_is_not_shown_raw_in_the_history():
    """En producción el historial mostró la clave de un KeyError y la consulta
    de un IntegrityError: texto para soporte, no para la clínica."""
    from app.modules.automations.application.engine import INTERNAL_ERROR_MESSAGE, _readable_error
    from app.modules.automations.domain.errors import StepFailed

    assert _readable_error(KeyError(("condition-1", "yes"))) == INTERNAL_ERROR_MESSAGE
    assert _readable_error(RuntimeError("(sqlalchemy.dialects.postgresql.asyncpg.IntegrityError) ...")) == INTERNAL_ERROR_MESSAGE
    assert _readable_error(StepFailed("El lead no tiene vendedor")) == "El lead no tiene vendedor"

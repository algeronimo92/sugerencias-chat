"""Un error al publicar o probar un flujo dice de qué bloque es (``target``).

Antes decía "Bloque 7", "Acción 3" o "Espera 2" (tres numeraciones internas,
ninguna la del lienzo) o directamente nada ("Todos los bloques deben estar
conectados desde el disparador"), y en un flujo de 50 bloques había que
buscarlo a ojo.
"""

from __future__ import annotations

import pytest

from app.modules.automations.domain.errors import InvalidAutomation
from app.modules.automations.domain.flow_definition import connect_flow, normalize_flow, without_position


def _flow(nodes: list[dict], edges: list[dict]) -> dict:
    return {"conditions": {}, "nodes": nodes, "edges": edges}


def _node(node_id: str, node_type: str, data: dict) -> dict:
    return {"id": node_id, "type": node_type, "position": {"x": 0, "y": 0}, "data": data}


TRIGGER = _node("inicio", "trigger", {"trigger_type": "manual"})
MESSAGE = _node("saludo", "action", {"action": {"type": "send_message", "text": "Hola {{nombre}}"}})
END = _node("fin", "end", {"label": "Fin"})


def _edge(source: str, target: str, handle: str = "next") -> dict:
    return {"id": f"{source}-{target}", "source": source, "target": target, "source_handle": handle}


def _error(definition: dict) -> InvalidAutomation:
    with pytest.raises(InvalidAutomation) as error:
        connect_flow(normalize_flow("Prueba", definition))
    return error.value


def test_a_loose_block_is_named() -> None:
    loose = _node("suelto", "action", {"action": {"type": "send_message", "text": "¿Y yo?"}})
    error = _error(_flow([TRIGGER, MESSAGE, loose, END], [_edge("inicio", "saludo"), _edge("saludo", "fin"), _edge("suelto", "fin")]))
    assert error.node_id == "suelto"
    assert error.to_response()["target"] == "suelto"


def test_a_missing_output_is_named() -> None:
    error = _error(_flow([TRIGGER, MESSAGE, END], [_edge("inicio", "saludo")]))
    assert error.node_id == "saludo"


def test_an_incomplete_block_is_named_without_internal_numbering() -> None:
    empty = _node("vacio", "action", {"action": {"type": "send_message", "text": ""}})
    error = _error(_flow([TRIGGER, MESSAGE, empty, END], [_edge("inicio", "saludo"), _edge("saludo", "vacio"), _edge("vacio", "fin")]))
    assert error.node_id == "vacio"
    # "Acción 2: escribe..." contaba solo los bloques Acción; el editor lo nombra con su #n.
    assert not error.detail.startswith("Acción")
    assert error.detail[0].isupper()


def test_errors_about_the_whole_flow_have_no_target() -> None:
    error = _error(_flow([TRIGGER, MESSAGE], [_edge("inicio", "saludo")]))
    assert error.node_id is None
    assert "target" not in error.to_response()


def test_without_position_only_strips_the_internal_prefix() -> None:
    assert without_position("Pregunta 3: escribe el mensaje") == "Escribe el mensaje"
    assert without_position("Condición 2, grupo 1: formato inválido") == "Formato inválido"
    assert without_position("El flujo debe tener al menos un bloque Fin") == "El flujo debe tener al menos un bloque Fin"

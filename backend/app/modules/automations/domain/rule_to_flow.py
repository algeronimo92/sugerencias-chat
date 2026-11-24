"""De una regla simple (disparador, condiciones y una lista de acciones) al
flujo visual equivalente: disparador → [espera] → acciones en orden → fin.

Las dos formas de construir una automatización hacían lo mismo: una regla
simple es un flujo en línea recta. Mantener las dos obligaba a duplicar el
editor, y a quien arma la automatización a elegir entre «regla» y «flujo»
antes de saber qué quería lograr.
"""

from __future__ import annotations

from app.modules.automations.domain.types import FlowHandle, FlowNodeType

_COLUMN = 320
_ROW = 220
_LEFT = 70


def flow_from_rule(rule: dict) -> dict:
    """La definición de flujo que hace lo mismo que ``rule``.

    Solo arma la forma; quien la guarda la valida como cualquier flujo."""
    trigger_data: dict = {"trigger_type": rule["trigger_type"]}
    minutes = (rule.get("trigger_config") or {}).get("minutes")
    if minutes:
        trigger_data["minutes"] = minutes
    steps: list[tuple[str, dict]] = []
    delay = int(rule.get("delay_minutes") or 0)
    if delay > 0:
        # En una regla simple la demora va antes de la primera acción.
        steps.append((FlowNodeType.WAIT, {"seconds": delay * 60}))
    steps.extend((FlowNodeType.ACTION, {"action": dict(action)}) for action in rule.get("actions") or [])

    nodes = [_node("trigger-1", FlowNodeType.TRIGGER, 0, trigger_data)]
    nodes.extend(
        _node(f"{node_type}-{position}", node_type, position, data)
        for position, (node_type, data) in enumerate(steps, start=1)
    )
    nodes.append(_node("end-1", FlowNodeType.END, len(steps) + 1, {"label": "Fin", "close_conversation": False}))
    edges = [
        {
            "id": f"edge-{source['id']}-{target['id']}",
            "source": source["id"], "target": target["id"], "source_handle": FlowHandle.NEXT,
        }
        for source, target in zip(nodes, nodes[1:])
    ]
    return {"conditions": dict(rule.get("conditions") or {}), "nodes": nodes, "edges": edges}


def _node(node_id: str, node_type: str, column: int, data: dict) -> dict:
    return {"id": node_id, "type": str(node_type), "position": {"x": _LEFT + _COLUMN * column, "y": _ROW}, "data": data}

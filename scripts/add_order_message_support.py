"""Añade de forma idempotente la rama orderMessage a un workflow de n8n.

Uso:
    python scripts/add_order_message_support.py "rag (6).json"

El script parte de los nodos ``Switch Control type1`` y
``unsupported content`` del workflow exportado. No toca credenciales ni otros
nodos y puede ejecutarse más de una vez sobre el mismo archivo.
"""

from __future__ import annotations

import argparse
import copy
import json
import uuid
from pathlib import Path
from typing import Any


ORDER_NODE_NAME = "order content"
SWITCH_NODE_NAME = "Switch Control type1"
FALLBACK_NODE_NAME = "unsupported content"
ORDER_NODE_ID = "46394445-d977-48d1-926e-fbeaf6921fa1"

CONTENT_EXPRESSION = (
    "={{ (() => { const data = (($json.body || {}).data || {}); "
    "const order = ((data.message || {}).orderMessage || {}); "
    "return order.message || order.orderTitle || 'Pedido de WhatsApp'; })() }}"
)

PAYLOAD_EXPRESSION = (
    "={{ (() => { const data = (($json.body || {}).data || {}); "
    "const order = ((data.message || {}).orderMessage || {}); "
    "const longValue = (value) => { if (value == null) return null; "
    "if (typeof value === 'number' || typeof value === 'string') return value; "
    "if (typeof value === 'object' && Number.isInteger(value.low)) { "
    "const high = Number.isInteger(value.high) ? value.high : 0; "
    "return String(high * 4294967296 + (value.low >>> 0)); } return null; }; "
    "const payload = { original_type: 'orderMessage', order_id: order.orderId || null, "
    "title: order.orderTitle || null, message: order.message || null, "
    "item_count: longValue(order.itemCount), status: order.status ?? null, "
    "surface: order.surface ?? null, total_amount_1000: longValue(order.totalAmount1000), "
    "currency: order.totalCurrencyCode || null }; "
    "return Object.fromEntries(Object.entries(payload).filter(([, value]) => value != null)); })() }}"
)

QUOTE_EXPRESSION = (
    "={{ (() => { const order = (((($json.body || {}).data || {}).message || {}).orderMessage || {}); "
    "return ((order.contextInfo || {}).stanzaId) || "
    "((order.orderRequestMessageId || {}).id) || null; })() }}"
)


def _node(workflow: dict[str, Any], name: str) -> dict[str, Any]:
    try:
        return next(node for node in workflow["nodes"] if node.get("name") == name)
    except StopIteration as exc:
        raise ValueError(f"El workflow no contiene el nodo requerido: {name}") from exc


def _assignment_id(name: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"dermicapro:n8n:order:{name}"))


def _set_assignment(node: dict[str, Any], name: str, value: Any, value_type: str) -> None:
    assignments = node["parameters"]["assignments"]["assignments"]
    current = next((item for item in assignments if item.get("name") == name), None)
    if current is None:
        current = {"id": _assignment_id(name), "name": name}
        assignments.append(current)
    current.update({"value": value, "type": value_type})


def _order_rule() -> dict[str, Any]:
    return {
        "conditions": {
            "options": {
                "caseSensitive": True,
                "leftValue": "",
                "typeValidation": "strict",
                "version": 2,
            },
            "conditions": [{
                "id": "f8237a7d-c207-4f82-84ce-a89287ea5a24",
                "leftValue": "={{ $json.body.data.messageType }}",
                "rightValue": "orderMessage",
                "operator": {
                    "type": "string",
                    "operation": "equals",
                    "name": "filter.operator.equals",
                },
            }],
            "combinator": "and",
        },
        "renameOutput": True,
        "outputKey": "order",
    }


def update_workflow(workflow: dict[str, Any]) -> bool:
    """Actualiza un objeto de workflow y devuelve si hubo cambios."""
    before = json.dumps(workflow, sort_keys=True, ensure_ascii=False)
    fallback = _node(workflow, FALLBACK_NODE_NAME)

    try:
        order_node = _node(workflow, ORDER_NODE_NAME)
    except ValueError:
        order_node = copy.deepcopy(fallback)
        workflow["nodes"].append(order_node)

    order_node["id"] = ORDER_NODE_ID
    order_node["name"] = ORDER_NODE_NAME
    fallback_position = fallback.get("position", [0, 0])
    order_node["position"] = [fallback_position[0], fallback_position[1] + 192]
    _set_assignment(order_node, "content", CONTENT_EXPRESSION, "string")
    _set_assignment(order_node, "message_type", "order", "string")
    _set_assignment(order_node, "payload", PAYLOAD_EXPRESSION, "object")
    _set_assignment(order_node, "media_url", "=", "string")
    _set_assignment(order_node, "quoted_wa_message_id", QUOTE_EXPRESSION, "string")

    switch = _node(workflow, SWITCH_NODE_NAME)
    rules = switch["parameters"]["rules"]["values"]
    rule_index = next(
        (index for index, rule in enumerate(rules)
         if any(condition.get("rightValue") == "orderMessage"
                for condition in rule.get("conditions", {}).get("conditions", []))),
        None,
    )
    outputs = workflow["connections"][SWITCH_NODE_NAME]["main"]
    if rule_index is None:
        # El último output es el fallback; la regla nueva se inserta delante.
        rule_index = len(rules)
        rules.append(_order_rule())
        outputs.insert(rule_index, [])
    else:
        rules[rule_index] = _order_rule()

    outputs[rule_index] = [{"node": ORDER_NODE_NAME, "type": "main", "index": 0}]
    fallback_connections = workflow["connections"].get(FALLBACK_NODE_NAME, {"main": [[]]})
    workflow["connections"][ORDER_NODE_NAME] = copy.deepcopy(fallback_connections)

    after = json.dumps(workflow, sort_keys=True, ensure_ascii=False)
    return before != after


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workflow", type=Path, nargs="+", help="JSON exportado por n8n")
    args = parser.parse_args()

    for path in args.workflow:
        workflow = json.loads(path.read_text(encoding="utf-8"))
        changed = update_workflow(workflow)
        if changed:
            path.write_text(
                json.dumps(workflow, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
        print(f"{path}: {'actualizado' if changed else 'sin cambios'}")


if __name__ == "__main__":
    main()

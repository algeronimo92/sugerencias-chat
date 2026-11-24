"""Qué automatizaciones preguntan por el horario de atención del negocio.

Hay tres lugares donde se puede preguntar: la condición de entrada «solo en
el horario de atención», un bloque Condición y la rama «fuera del horario»
de un bloque Pausa. Configuración lo muestra junto al horario para que quien
lo cambie sepa qué va a cambiar con él: sin eso, ajustarlo es un acto de fe.
"""

from __future__ import annotations

from app.modules.automations.domain.types import FlowConditionType, FlowNodeType, WaitAnyConditionKind


def _condition_node_asks(data: dict) -> bool:
    groups = data.get("condition_groups")
    conditions = (
        [condition for group in groups if isinstance(group, dict) for condition in (group.get("conditions") or [])]
        if isinstance(groups, list)
        # Definiciones publicadas antes de los grupos: una sola condición.
        else [data]
    )
    return any(
        isinstance(condition, dict) and condition.get("condition_type") == FlowConditionType.BUSINESS_HOURS
        for condition in conditions
    )


def _node_asks(node: object) -> bool:
    if not isinstance(node, dict) or not isinstance(node.get("data"), dict):
        return False
    data = node["data"]
    if node.get("type") == FlowNodeType.CONDITION:
        return _condition_node_asks(data)
    if node.get("type") == FlowNodeType.WAIT_ANY:
        return any(
            isinstance(condition, dict) and condition.get("kind") == WaitAnyConditionKind.BUSINESS_HOURS
            for condition in (data.get("conditions") or [])
        )
    return False


def uses_business_hours(conditions: object, flow_definition: object) -> bool:
    """¿La regla, tal como corre hoy, pregunta por el horario de atención?

    ``flow_definition`` es la versión que el motor ejecuta (la publicada); en
    una regla simple no hay flujo y solo cuentan sus condiciones."""
    flow = flow_definition if isinstance(flow_definition, dict) else {}
    for entry in (conditions, flow.get("conditions")):
        if isinstance(entry, dict) and entry.get("business_hours_only"):
            return True
    nodes = flow.get("nodes")
    return any(_node_asks(node) for node in (nodes if isinstance(nodes, list) else []))

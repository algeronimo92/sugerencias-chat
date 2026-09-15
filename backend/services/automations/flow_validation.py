from sqlalchemy import select

from db.models import AutomationRule, LeadTag, User
from db.session import get_sessionmaker
from domain_types import (
    AutomationActionType,
    AutomationBuilderMode,
    AutomationTrigger,
    FlowNodeType,
)
from services.automation_rules import normalize_edges, validate_graph_topology
from services.automation_scheduling import TRIGGER_TYPES
from services.automations.common import (
    FLOW_NODE_TYPES,
    MAX_FLOW_EDGES,
    MAX_FLOW_NODES,
)
from services.automations.flow_nodes import (
    FlowNodeRef,
    FlowValidationFacts,
    _flow_node_handler,
)
from services.automations.rule_validation import (
    _normalize_automation_conditions,
    _normalize_flow_position,
    validate_automation_rule,
)


def normalize_visual_draft(name: str, definition: dict) -> dict:
    name = str(name or "").strip()
    if not name or len(name) > 120:
        raise ValueError("El nombre debe tener entre 1 y 120 caracteres")
    if not isinstance(definition, dict):
        raise ValueError("La definición del flujo no es válida")
    conditions = _normalize_automation_conditions(definition.get("conditions"))
    raw_nodes = definition.get("nodes")
    raw_edges = definition.get("edges")
    if not isinstance(raw_nodes, list) or not 1 <= len(raw_nodes) <= MAX_FLOW_NODES:
        raise ValueError(f"El borrador debe tener entre 1 y {MAX_FLOW_NODES} bloques")
    if not isinstance(raw_edges, list) or len(raw_edges) > MAX_FLOW_EDGES:
        raise ValueError(f"El borrador admite hasta {MAX_FLOW_EDGES} conexiones")
    nodes: list[dict] = []
    ids: set[str] = set()
    for position, raw_node in enumerate(raw_nodes, start=1):
        if not isinstance(raw_node, dict):
            raise ValueError(f"Bloque {position}: formato inválido")
        node_id = str(raw_node.get("id") or "").strip()[:80]
        node_type = str(raw_node.get("type") or "")
        if not node_id or node_id in ids:
            raise ValueError(f"Bloque {position}: identificador vacío o duplicado")
        if node_type not in FLOW_NODE_TYPES:
            raise ValueError(f"Bloque {position}: tipo no soportado")
        ids.add(node_id)
        nodes.append({
            "id": node_id, "type": node_type,
            "position": _normalize_flow_position(raw_node.get("position")),
            "data": raw_node.get("data") if isinstance(raw_node.get("data"), dict) else {},
        })
    # Los bloques Pausa (wait_any) usan como handle el "kind" de cada
    # condición ("timer"/"message"/...), Pregunta (question) usa
    # "btn_1".."btn_n" + "other" + "timeout" y Round robin "out_1".."out_n" —
    # ninguno está en el enum fijo FlowHandle. Se admiten acá para que el
    # borrador se pueda guardar mientras se arma (autosave), sin bloquear por
    # una conexión que la validación estricta de validate_graph_topology
    # recién exige al publicar.
    dynamic_handles = set().union(*(
        _flow_node_handler(node["type"]).dynamic_handles(node["data"]) for node in nodes
    ))
    edges = normalize_edges(raw_edges, ids, allow_duplicate_handles=False, extra_handles=dynamic_handles)
    trigger = next((node for node in nodes if node["type"] == FlowNodeType.TRIGGER), None)
    trigger_data = trigger["data"] if trigger else {}
    trigger_type = (
        trigger_data.get("trigger_type")
        if trigger_data.get("trigger_type") in TRIGGER_TYPES
        else AutomationTrigger.LEAD_CREATED
    )
    trigger_config = {}
    if trigger_type in {
        AutomationTrigger.SELLER_RESPONSE_OVERDUE,
        AutomationTrigger.CUSTOMER_RESPONSE_OVERDUE,
    }:
        minutes = int(trigger_data.get("minutes") or 30)
        trigger_config = {"minutes": max(1, min(43200, minutes))}
    return {
        "name": name, "trigger_type": trigger_type, "trigger_config": trigger_config,
        "conditions": conditions,
        "flow_definition": {"conditions": conditions, "nodes": nodes, "edges": edges},
    }


def _invoked_flow_ids(definition: dict | None) -> set[int]:
    """Devuelve las reglas referenciadas por bloques Invocar flujo."""
    return {
        int(node.get("data", {}).get("flow_rule_id") or 0)
        for node in (definition or {}).get("nodes", [])
        if node.get("type") == FlowNodeType.INVOKE_FLOW
        and int(node.get("data", {}).get("flow_rule_id") or 0) > 0
    }


async def _validate_invoked_flows(
    session, target_ids: set[int], current_rule_id: int | None, candidate_definition: dict,
) -> None:
    if not target_ids:
        return
    rows = (await session.execute(select(
        AutomationRule.id,
        AutomationRule.name,
        AutomationRule.builder_mode,
        AutomationRule.published_flow_definition,
    ).where(AutomationRule.deleted_at.is_(None)))).mappings().all()
    rules = {row["id"]: row for row in rows}
    for target_id in target_ids:
        target = rules.get(target_id)
        if target is None:
            raise ValueError(f"El flujo invocado #{target_id} no existe")
        if current_rule_id is not None and target_id == current_rule_id:
            raise ValueError("Un flujo no puede invocarse a sí mismo")
        if target["builder_mode"] != AutomationBuilderMode.VISUAL:
            raise ValueError(f"{target['name']} no es un flujo visual")
        if not target["published_flow_definition"]:
            raise ValueError(f"Publica el flujo hijo {target['name']} antes de invocarlo")

    if current_rule_id is None:
        return
    dependencies = {
        rule_id: _invoked_flow_ids(row["published_flow_definition"])
        for rule_id, row in rules.items()
    }
    dependencies[current_rule_id] = _invoked_flow_ids(candidate_definition)
    visiting: set[int] = set()
    visited: set[int] = set()

    def walk(rule_id: int) -> None:
        if rule_id in visiting:
            raise ValueError("La invocación entre flujos contiene un ciclo")
        if rule_id in visited:
            return
        visiting.add(rule_id)
        for child_id in dependencies.get(rule_id, set()):
            walk(child_id)
        visiting.remove(rule_id)
        visited.add(rule_id)

    walk(current_rule_id)


async def validate_visual_flow(
    name: str, definition: dict, *, current_rule_id: int | None = None,
) -> dict:
    name = str(name or "").strip()
    if not name or len(name) > 120:
        raise ValueError("El nombre debe tener entre 1 y 120 caracteres")
    if not isinstance(definition, dict):
        raise ValueError("La definición del flujo no es válida")
    raw_conditions = definition.get("conditions")
    raw_nodes = definition.get("nodes")
    raw_edges = definition.get("edges")
    if not isinstance(raw_nodes, list) or not 2 <= len(raw_nodes) <= MAX_FLOW_NODES:
        raise ValueError(f"El flujo debe tener entre 2 y {MAX_FLOW_NODES} bloques")
    if not isinstance(raw_edges, list) or len(raw_edges) > MAX_FLOW_EDGES:
        raise ValueError(f"El flujo admite hasta {MAX_FLOW_EDGES} conexiones")

    ids: set[str] = set()
    normalized_nodes: list[dict] = []
    facts = FlowValidationFacts()
    for position, raw_node in enumerate(raw_nodes, start=1):
        if not isinstance(raw_node, dict):
            raise ValueError(f"Bloque {position}: formato inválido")
        node_id = str(raw_node.get("id") or "").strip()[:80]
        node_type = str(raw_node.get("type") or "")
        data = raw_node.get("data") if isinstance(raw_node.get("data"), dict) else {}
        if not node_id or node_id in ids:
            raise ValueError(f"Bloque {position}: identificador vacío o duplicado")
        if node_type not in FLOW_NODE_TYPES:
            raise ValueError(f"Bloque {position}: tipo no soportado")
        ids.add(node_id)
        normalized_data = await _flow_node_handler(node_type).normalize(
            name, data, FlowNodeRef(node_id, position, len(normalized_nodes)), facts,
        )
        normalized_nodes.append({
            "id": node_id,
            "type": node_type,
            "position": _normalize_flow_position(raw_node.get("position")),
            "data": normalized_data,
        })
    trigger_nodes = facts.trigger_nodes
    action_nodes = facts.action_nodes
    invoke_flow_nodes = facts.invoke_flow_nodes
    condition_users = facts.condition_users
    condition_tags = facts.condition_tags

    if len(trigger_nodes) != 1:
        raise ValueError("El flujo debe tener exactamente un disparador")
    if not facts.end_count:
        raise ValueError("El flujo debe tener al menos un bloque Fin")
    if not action_nodes and not invoke_flow_nodes:
        raise ValueError("El flujo debe tener al menos una acción o invocación")

    # MAX_ACTIONS (10) es el tope del modo simple, una lista plana y
    # secuencial. Acá sumamos los bloques Acción de TODAS las ramas del
    # grafo aunque una ejecución nunca recorra más de una, así que se acota
    # por MAX_FLOW_NODES (el tope estructural del flujo) en vez de MAX_ACTIONS.
    actions_for_validation = [action for _, action in action_nodes] or [
        {"type": AutomationActionType.CHANGE_STAGE, "stage": "nuevo"}
    ]
    normalized_action_values = await validate_automation_rule({
        "name": name,
        "trigger_type": trigger_nodes[0]["data"]["trigger_type"],
        "trigger_config": {"minutes": trigger_nodes[0]["data"].get("minutes")},
        "conditions": raw_conditions,
        "actions": actions_for_validation,
        "delay_minutes": 0,
        "is_active": False,
    }, max_actions=MAX_FLOW_NODES)
    for (node_index, _), normalized_action in zip(action_nodes, normalized_action_values["actions"]):
        normalized_nodes[node_index]["data"]["action"] = normalized_action

    async with get_sessionmaker()() as session:
        if condition_users:
            found = set((await session.execute(select(User.id).where(
                User.id.in_(condition_users), User.is_active.is_(True)
            ))).scalars().all())
            if found != condition_users:
                raise ValueError("Algún vendedor usado en una condición no existe o está inactivo")
        if condition_tags:
            found = set((await session.execute(select(LeadTag.id).where(
                LeadTag.id.in_(condition_tags), LeadTag.is_active.is_(True)
            ))).scalars().all())
            if found != condition_tags:
                raise ValueError("Alguna etiqueta usada en una condición no existe o está inactiva")
        await _validate_invoked_flows(
            session,
            {flow_rule_id for _, flow_rule_id in invoke_flow_nodes},
            current_rule_id,
            {"nodes": normalized_nodes},
        )

    normalized_edges = normalize_edges(raw_edges, ids)
    validate_graph_topology(normalized_nodes, normalized_edges, trigger_nodes[0]["id"])

    return {
        "name": name,
        "trigger_type": trigger_nodes[0]["data"]["trigger_type"],
        "trigger_config": normalized_action_values["trigger_config"],
        "conditions": normalized_action_values["conditions"],
        "flow_definition": {
            "conditions": normalized_action_values["conditions"],
            "nodes": normalized_nodes,
            "edges": normalized_edges,
        },
    }

"""Definición de un flujo visual: normalizar cada bloque, armar el borrador
que se guarda mientras se edita y validar lo que se publica.

La parte que necesita la base (que existan los vendedores, etiquetas, etapas
y flujos hijos que el flujo menciona) la resuelve ``application.validation``
con las referencias que junta este módulo. El orden de las comprobaciones es
el mismo de siempre, así que cada error sigue saliendo con su mensaje.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass, field

from app.modules.automations.domain.types import AutomationBuilderMode, AutomationTrigger, FlowConditionType, FlowNodeType, QuestionHandle

from app.modules.automations.domain.flow_graph import normalize_edges, validate_graph_topology
from app.modules.automations.domain.limits import FLOW_NODE_TYPES, MAX_FLOW_EDGES, MAX_FLOW_NODES, TRIGGER_TYPES
from app.modules.automations.domain.rules import normalize_conditions, normalize_flow_position, wait_seconds
from app.modules.automations.domain.validation import (
    OVERDUE_TRIGGERS,
    ActionReferences,
    normalize_actions,
    normalize_flow_condition_node,
    normalize_question,
    normalize_round_robin,
    normalize_trigger,
    normalize_wait_any_conditions,
)


@dataclass
class FlowValidationFacts:
    trigger_nodes: list[dict] = field(default_factory=list)
    action_nodes: list[tuple[int, dict]] = field(default_factory=list)
    invoke_flow_nodes: list[tuple[int, int]] = field(default_factory=list)
    condition_users: set[int] = field(default_factory=set)
    condition_tags: set[int] = field(default_factory=set)
    condition_stages: set[str] = field(default_factory=set)
    end_count: int = 0


@dataclass(frozen=True)
class FlowNodeRef:
    id: str
    position: int
    index: int


NodeNormalizer = Callable[[dict, FlowNodeRef, FlowValidationFacts], dict]


def _normalize_trigger_node(data: dict, ref: FlowNodeRef, facts: FlowValidationFacts) -> dict:
    trigger_type, trigger_config = normalize_trigger(data.get("trigger_type"), {"minutes": data.get("minutes")})
    normalized = {"trigger_type": trigger_type, "minutes": trigger_config.get("minutes")}
    facts.trigger_nodes.append({"id": ref.id, "data": normalized})
    return normalized


def _normalize_condition_node(data: dict, ref: FlowNodeRef, facts: FlowValidationFacts) -> dict:
    normalized, user_ids, tag_ids = normalize_flow_condition_node(data, ref.position)
    facts.condition_users.update(user_ids)
    facts.condition_tags.update(tag_ids)
    facts.condition_stages.update(
        condition["value"]
        for group in normalized["condition_groups"]
        for condition in group["conditions"]
        if condition["condition_type"] == FlowConditionType.STAGE_EQUALS
    )
    return normalized


def _normalize_action_node(data: dict, ref: FlowNodeRef, facts: FlowValidationFacts) -> dict:
    action = data.get("action") if isinstance(data.get("action"), dict) else {}
    facts.action_nodes.append((ref.index, action))
    return {"action": action}


def _normalize_invoke_flow_node(data: dict, ref: FlowNodeRef, facts: FlowValidationFacts) -> dict:
    flow_rule_id = int(data.get("flow_rule_id") or 0)
    if not flow_rule_id:
        raise ValueError(f"Invocación {ref.position}: selecciona un flujo hijo")
    facts.invoke_flow_nodes.append((ref.index, flow_rule_id))
    return {"flow_rule_id": flow_rule_id}


def _normalize_wait_node(data: dict, ref: FlowNodeRef, facts: FlowValidationFacts) -> dict:
    seconds = wait_seconds(data)
    if not 1 <= seconds <= 604800:
        raise ValueError(f"Espera {ref.position}: configura entre 1 segundo y 7 días")
    return {"seconds": seconds}


def _normalize_end_node(data: dict, ref: FlowNodeRef, facts: FlowValidationFacts) -> dict:
    facts.end_count += 1
    return {
        "label": str(data.get("label") or "Fin").strip()[:80] or "Fin",
        "close_conversation": data.get("close_conversation") is True,
    }


NODE_NORMALIZERS: dict[FlowNodeType, NodeNormalizer] = {
    FlowNodeType.TRIGGER: _normalize_trigger_node,
    FlowNodeType.CONDITION: _normalize_condition_node,
    FlowNodeType.ACTION: _normalize_action_node,
    FlowNodeType.INVOKE_FLOW: _normalize_invoke_flow_node,
    FlowNodeType.WAIT: _normalize_wait_node,
    FlowNodeType.WAIT_ANY: lambda data, ref, facts: normalize_wait_any_conditions(data, ref.position),
    FlowNodeType.QUESTION: lambda data, ref, facts: normalize_question(data, ref.position),
    FlowNodeType.ROUND_ROBIN: lambda data, ref, facts: normalize_round_robin(data, ref.position),
    FlowNodeType.END: _normalize_end_node,
}


def _ids_of(items: object, key: str) -> set[str]:
    return {
        item[key]
        for item in (items if isinstance(items, list) else [])
        if isinstance(item, dict) and isinstance(item.get(key), str)
    }


def dynamic_handles(node_type: str, data: dict) -> set[str]:
    """Salidas de un bloque que no están en el enum fijo ``FlowHandle``: los
    grupos de una Condición, las condiciones de una Pausa, los botones de una
    Pregunta y las salidas de un Round robin."""
    if node_type == FlowNodeType.CONDITION:
        return _ids_of(data.get("condition_groups"), "id")
    if node_type == FlowNodeType.WAIT_ANY:
        return _ids_of(data.get("conditions"), "kind")
    if node_type == FlowNodeType.QUESTION:
        return _ids_of(data.get("buttons"), "id") | {QuestionHandle.OTHER, QuestionHandle.TIMEOUT, QuestionHandle.MEDIA}
    if node_type == FlowNodeType.ROUND_ROBIN:
        return _ids_of(data.get("outputs"), "id")
    return set()


def _validate_name(name: object) -> str:
    name = str(name or "").strip()
    if not name or len(name) > 120:
        raise ValueError("El nombre debe tener entre 1 y 120 caracteres")
    return name


def normalize_visual_draft(name: str, definition: dict) -> dict:
    """El borrador que se guarda mientras se arma (autosave): forma válida,
    sin exigir todavía que el grafo esté completo."""
    name = _validate_name(name)
    if not isinstance(definition, dict):
        raise ValueError("La definición del flujo no es válida")
    conditions = normalize_conditions(definition.get("conditions"))
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
            "position": normalize_flow_position(raw_node.get("position")),
            "data": raw_node.get("data") if isinstance(raw_node.get("data"), dict) else {},
        })
    # Los handles dinámicos se admiten acá para que el borrador se pueda
    # guardar mientras se arma, sin bloquear por una conexión que la
    # validación estricta de validate_graph_topology recién exige al publicar.
    extra_handles = set().union(*(dynamic_handles(node["type"], node["data"]) for node in nodes))
    edges = normalize_edges(raw_edges, ids, allow_duplicate_handles=False, extra_handles=extra_handles)
    trigger = next((node for node in nodes if node["type"] == FlowNodeType.TRIGGER), None)
    trigger_data = trigger["data"] if trigger else {}
    trigger_type = (
        trigger_data.get("trigger_type")
        if trigger_data.get("trigger_type") in TRIGGER_TYPES
        else AutomationTrigger.LEAD_CREATED
    )
    trigger_config = {}
    if trigger_type in OVERDUE_TRIGGERS:
        minutes = int(trigger_data.get("minutes") or 30)
        trigger_config = {"minutes": max(1, min(43200, minutes))}
    return {
        "name": name, "trigger_type": trigger_type, "trigger_config": trigger_config,
        "conditions": conditions,
        "flow_definition": {"conditions": conditions, "nodes": nodes, "edges": edges},
    }


@dataclass
class NormalizedFlow:
    """Un flujo con cada bloque normalizado y las referencias que falta
    verificar contra la base antes de conectar el grafo."""

    name: str
    trigger_type: str
    trigger_config: dict
    conditions: dict
    nodes: list[dict]
    node_ids: set[str]
    raw_edges: list
    trigger_id: str
    # Lo que mencionan las acciones y las condiciones de entrada.
    refs: ActionReferences
    # Lo que mencionan los bloques Condición (con sus propios mensajes).
    condition_users: set[int]
    condition_tags: set[int]
    condition_stages: set[str]
    invoked_flow_ids: set[int]


def normalize_flow(name: str, definition: dict) -> NormalizedFlow:
    name = _validate_name(name)
    if not isinstance(definition, dict):
        raise ValueError("La definición del flujo no es válida")
    raw_nodes = definition.get("nodes")
    raw_edges = definition.get("edges")
    if not isinstance(raw_nodes, list) or not 2 <= len(raw_nodes) <= MAX_FLOW_NODES:
        raise ValueError(f"El flujo debe tener entre 2 y {MAX_FLOW_NODES} bloques")
    if not isinstance(raw_edges, list) or len(raw_edges) > MAX_FLOW_EDGES:
        raise ValueError(f"El flujo admite hasta {MAX_FLOW_EDGES} conexiones")

    ids: set[str] = set()
    nodes: list[dict] = []
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
        normalized_data = NODE_NORMALIZERS[FlowNodeType(node_type)](
            data, FlowNodeRef(node_id, position, len(nodes)), facts,
        )
        nodes.append({
            "id": node_id,
            "type": node_type,
            "position": normalize_flow_position(raw_node.get("position")),
            "data": normalized_data,
        })

    if len(facts.trigger_nodes) != 1:
        raise ValueError("El flujo debe tener exactamente un disparador")
    if not facts.end_count:
        raise ValueError("El flujo debe tener al menos un bloque Fin")
    if not facts.action_nodes and not facts.invoke_flow_nodes:
        raise ValueError("El flujo debe tener al menos una acción o invocación")

    trigger = facts.trigger_nodes[0]
    trigger_type, trigger_config = normalize_trigger(
        trigger["data"]["trigger_type"], {"minutes": trigger["data"].get("minutes")},
    )
    conditions = normalize_conditions(definition.get("conditions"))
    refs = ActionReferences()
    if facts.action_nodes:
        # MAX_ACTIONS (10) es el tope del modo simple, una lista plana y
        # secuencial. Acá se suman los bloques Acción de TODAS las ramas del
        # grafo aunque una ejecución nunca recorra más de una, así que se
        # acota por MAX_FLOW_NODES (el tope estructural del flujo).
        actions = normalize_actions(
            [action for _, action in facts.action_nodes], refs, max_actions=MAX_FLOW_NODES,
        )
        for (node_index, _), action in zip(facts.action_nodes, actions):
            nodes[node_index]["data"]["action"] = action
    if conditions["seller_id"]:
        refs.users.add(conditions["seller_id"])
    if conditions["tag_id"]:
        refs.tags.add(conditions["tag_id"])
    if conditions["stage"]:
        refs.condition_stages.add(conditions["stage"])
    return NormalizedFlow(
        name=name,
        trigger_type=trigger_type,
        trigger_config=trigger_config,
        conditions=conditions,
        nodes=nodes,
        node_ids=ids,
        raw_edges=raw_edges,
        trigger_id=trigger["id"],
        refs=refs,
        condition_users=facts.condition_users,
        condition_tags=facts.condition_tags,
        condition_stages=facts.condition_stages,
        invoked_flow_ids={flow_rule_id for _, flow_rule_id in facts.invoke_flow_nodes},
    )


def connect_flow(flow: NormalizedFlow) -> dict:
    """Último paso, ya verificadas las referencias: conexiones y topología."""
    edges = normalize_edges(flow.raw_edges, flow.node_ids)
    validate_graph_topology(flow.nodes, edges, flow.trigger_id)
    return {
        "name": flow.name,
        "trigger_type": flow.trigger_type,
        "trigger_config": flow.trigger_config,
        "conditions": flow.conditions,
        "flow_definition": {"conditions": flow.conditions, "nodes": flow.nodes, "edges": edges},
    }


def invoked_flow_ids(definition: dict | None) -> set[int]:
    """Devuelve las reglas referenciadas por bloques Invocar flujo."""
    return {
        int(node.get("data", {}).get("flow_rule_id") or 0)
        for node in (definition or {}).get("nodes", [])
        if node.get("type") == FlowNodeType.INVOKE_FLOW
        and int(node.get("data", {}).get("flow_rule_id") or 0) > 0
    }


def check_invoked_flows(
    rules: Mapping[int, Mapping],
    target_ids: set[int],
    current_rule_id: int | None,
    candidate_definition: dict,
) -> None:
    """``rules`` son las reglas no borradas por id, con ``name``,
    ``builder_mode`` y ``published_flow_definition``."""
    if not target_ids:
        return
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
        rule_id: invoked_flow_ids(row["published_flow_definition"])
        for rule_id, row in rules.items()
    }
    dependencies[current_rule_id] = invoked_flow_ids(candidate_definition)
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

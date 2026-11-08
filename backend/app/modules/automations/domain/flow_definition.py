"""Definición de un flujo visual: normalizar cada bloque, armar el borrador
que se guarda mientras se edita y validar lo que se publica.

La parte que necesita la base (que existan los vendedores, etiquetas, etapas
y flujos hijos que el flujo menciona) la resuelve ``application.validation``
con las referencias que junta este módulo. El orden de las comprobaciones es
el mismo de siempre, así que cada error sigue saliendo con su mensaje.
"""

from __future__ import annotations

import re
from collections.abc import Callable, Mapping
from contextlib import contextmanager
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
from app.modules.automations.domain.errors import InvalidAutomation, rejects_malformed_input


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
        raise InvalidAutomation("Elige qué flujo se iniciará.")
    facts.invoke_flow_nodes.append((ref.index, flow_rule_id))
    return {"flow_rule_id": flow_rule_id}


def _normalize_wait_node(data: dict, ref: FlowNodeRef, facts: FlowValidationFacts) -> dict:
    seconds = wait_seconds(data)
    if not 1 <= seconds <= 604800:
        raise InvalidAutomation("La pausa debe durar entre 1 segundo y 7 días.")
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
        raise InvalidAutomation("Escribe un nombre para el flujo (hasta 120 caracteres).")
    return name


@rejects_malformed_input
def normalize_visual_draft(name: str, definition: dict) -> dict:
    """El borrador que se guarda mientras se arma (autosave): forma válida,
    sin exigir todavía que el grafo esté completo."""
    name = _validate_name(name)
    if not isinstance(definition, dict):
        raise InvalidAutomation("No se pudo leer el flujo. Si importaste un JSON, revisa que sea un flujo completo.")
    conditions = normalize_conditions(definition.get("conditions"))
    raw_nodes = definition.get("nodes")
    raw_edges = definition.get("edges")
    if not isinstance(raw_nodes, list) or not 1 <= len(raw_nodes) <= MAX_FLOW_NODES:
        raise InvalidAutomation(f"Un flujo puede tener hasta {MAX_FLOW_NODES} bloques. Pasa una parte a otro flujo y llámalo con «Iniciar otro flujo».")
    if not isinstance(raw_edges, list) or len(raw_edges) > MAX_FLOW_EDGES:
        raise InvalidAutomation(f"Un flujo puede tener hasta {MAX_FLOW_EDGES} conexiones. Pasa una parte a otro flujo y llámalo con «Iniciar otro flujo».")
    nodes: list[dict] = []
    ids: set[str] = set()
    for raw_node in raw_nodes:
        if not isinstance(raw_node, dict):
            raise InvalidAutomation("Un bloque no se pudo leer. Si importaste un JSON, revísalo.")
        node_id = str(raw_node.get("id") or "").strip()[:80]
        node_type = str(raw_node.get("type") or "")
        if not node_id or node_id in ids:
            raise InvalidAutomation("Hay dos bloques con el mismo identificador, o uno sin identificador. Si importaste un JSON, revísalo.")
        if node_type not in FLOW_NODE_TYPES:
            raise InvalidAutomation("Hay un bloque de un tipo que no existe. Si importaste un JSON, revísalo.")
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


# "Acción 3: ", "Pregunta 2: ", "Condición 4, grupo 1: "...: la numeración
# interna con la que los normalizadores encabezaban su mensaje. Hoy solo las
# acciones la conservan, porque las Reglas simples la muestran; dentro de un
# flujo sobra: el error lleva el bloque y el editor lo nombra con su #n.
_POSITION_PREFIX = re.compile(
    r"^(?:Acción|Bloque|Condición|Espera|Invocación|Pausa|Pregunta|Round robin|Reparto)\s+\d+(?:,\s*grupo\s+\d+)?:\s*"
)


def without_position(detail: object) -> object:
    if not isinstance(detail, str):
        return detail
    stripped = _POSITION_PREFIX.sub("", detail, count=1)
    return stripped[:1].upper() + stripped[1:] if stripped != detail else detail


@contextmanager
def about_node(node_id: str):
    """Un error de validación dentro de un bloque queda atado a ese bloque."""
    try:
        yield
    except InvalidAutomation as exc:
        if exc.node_id is not None:
            raise
        raise InvalidAutomation(without_position(exc.detail), code=exc.code, node_id=node_id) from exc


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


@rejects_malformed_input
def normalize_flow(name: str, definition: dict) -> NormalizedFlow:
    name = _validate_name(name)
    if not isinstance(definition, dict):
        raise InvalidAutomation("No se pudo leer el flujo. Si importaste un JSON, revisa que sea un flujo completo.")
    raw_nodes = definition.get("nodes")
    raw_edges = definition.get("edges")
    if not isinstance(raw_nodes, list) or not 2 <= len(raw_nodes) <= MAX_FLOW_NODES:
        raise InvalidAutomation(f"Para publicar, el flujo necesita entre 2 y {MAX_FLOW_NODES} bloques. Si tienes más, pasa una parte a otro flujo y llámalo con «Iniciar otro flujo».")
    if not isinstance(raw_edges, list) or len(raw_edges) > MAX_FLOW_EDGES:
        raise InvalidAutomation(f"Un flujo puede tener hasta {MAX_FLOW_EDGES} conexiones. Pasa una parte a otro flujo y llámalo con «Iniciar otro flujo».")

    ids: set[str] = set()
    nodes: list[dict] = []
    facts = FlowValidationFacts()
    for position, raw_node in enumerate(raw_nodes, start=1):
        if not isinstance(raw_node, dict):
            raise InvalidAutomation("Un bloque no se pudo leer. Si importaste un JSON, revísalo.")
        node_id = str(raw_node.get("id") or "").strip()[:80]
        node_type = str(raw_node.get("type") or "")
        data = raw_node.get("data") if isinstance(raw_node.get("data"), dict) else {}
        if not node_id or node_id in ids:
            raise InvalidAutomation("Hay dos bloques con el mismo identificador, o uno sin identificador. Si importaste un JSON, revísalo.")
        if node_type not in FLOW_NODE_TYPES:
            raise InvalidAutomation("Hay un bloque de un tipo que no existe. Si importaste un JSON, revísalo.")
        ids.add(node_id)
        with about_node(node_id):
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
        raise InvalidAutomation("El flujo debe empezar con un solo disparador. Si importaste un JSON, revisa que tenga uno.")
    if not facts.end_count:
        raise InvalidAutomation("Falta un bloque Fin. Agrégalo desde la barra izquierda y conecta el último paso a él.")
    if not facts.action_nodes and not facts.invoke_flow_nodes:
        raise InvalidAutomation("El flujo todavía no hace nada: agrega al menos una Acción o un bloque «Iniciar otro flujo».")

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
        # De a una por bloque: así el error dice de qué bloque es. En lote
        # decía "Acción 3", contando solo los bloques Acción.
        for node_index, raw_action in facts.action_nodes:
            with about_node(nodes[node_index]["id"]):
                nodes[node_index]["data"]["action"] = normalize_actions([raw_action], refs, max_actions=1)[0]
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


def _invoking_node(definition: dict, target_id: int) -> str | None:
    """El bloque Iniciar otro flujo que apunta a ``target_id``: el error de
    un destino inválido se ata a él para que el editor lleve al bloque."""
    return next(
        (
            node.get("id")
            for node in (definition or {}).get("nodes", [])
            if node.get("type") == FlowNodeType.INVOKE_FLOW
            and int(node.get("data", {}).get("flow_rule_id") or 0) == target_id
        ),
        None,
    )


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
        node_id = _invoking_node(candidate_definition, target_id)
        if target is None:
            raise InvalidAutomation(
                f"El flujo #{target_id} ya no existe. Elige otro en «Flujo que se inicia».", node_id=node_id,
            )
        if current_rule_id is not None and target_id == current_rule_id:
            raise InvalidAutomation("Un flujo no puede iniciarse a sí mismo. Elige otro flujo.", node_id=node_id)
        if target["builder_mode"] != AutomationBuilderMode.VISUAL:
            raise InvalidAutomation(
                f"«{target['name']}» es una regla simple y no se puede iniciar desde un flujo. Elige un flujo visual.",
                node_id=node_id,
            )
        if not target["published_flow_definition"]:
            raise InvalidAutomation(
                f"Publica primero «{target['name']}» para poder iniciarlo desde aquí.", node_id=node_id,
            )

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
            raise InvalidAutomation("Estos flujos se inician entre sí en círculo y se repetirían sin fin. Quita uno de los bloques «Iniciar otro flujo».")
        if rule_id in visited:
            return
        visiting.add(rule_id)
        for child_id in dependencies.get(rule_id, set()):
            walk(child_id)
        visiting.remove(rule_id)
        visited.add(rule_id)

    walk(current_rule_id)

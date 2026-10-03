"""Simular un flujo visual sobre un lead: qué camino recorrería, sin mandar
nada ni gastar turnos de un Round robin."""

from __future__ import annotations

from app.modules.automations.domain.types import AutomationBuilderMode, AutomationExecutionStatus, FlowNodeType

from app.modules.automations.application.conditions import matches_condition_values
from app.modules.automations.application.deps import AutomationDeps, default_deps
from app.modules.automations.application.flow_nodes import FlowSimulation, flow_node_handler
from app.modules.automations.application.ports import automation_ports
from app.modules.automations.application.validation import validate_visual_flow
from app.modules.automations.domain.flow_graph import flow_indexes
from app.modules.automations.domain.limits import MAX_FLOW_NODES


async def simulate_visual_flow(rule_id: int, lead_id: str, deps: AutomationDeps | None = None) -> dict:
    deps = deps or default_deps()
    current = await automation_ports().rules.get(rule_id)
    if current is None or current["builder_mode"] != AutomationBuilderMode.VISUAL:
        raise ValueError("Flujo visual no encontrado")
    validated = await validate_visual_flow(
        current["name"], current["flow_definition"], current_rule_id=rule_id,
    )
    chat = await deps.fetch_chat(lead_id)
    if not chat:
        raise ValueError("Lead no encontrado")
    matches, reason = await matches_condition_values(validated["conditions"], chat, rule_id, deps)
    if not matches:
        return {
            "lead_id": chat["chat_id"],
            "lead_name": chat.get("name"),
            "flow_version": current["flow_version"],
            "path": [{
                "type": "entry_conditions",
                "status": AutomationExecutionStatus.SKIPPED,
                "detail": reason,
            }],
        }
    nodes, edges = flow_indexes(validated["flow_definition"])
    trigger = next(node for node in nodes.values() if node["type"] == FlowNodeType.TRIGGER)
    current_id = trigger["id"]
    simulation = FlowSimulation(rule_id=rule_id, chat=chat, edges=edges, path=[], deps=deps)
    for _ in range(MAX_FLOW_NODES + 1):
        node = nodes[current_id]
        current_id = await flow_node_handler(node["type"]).simulate(node, simulation)
        if current_id is None:
            return {
                "lead_id": chat["chat_id"], "lead_name": chat.get("name"),
                "flow_version": current["flow_version"], "path": simulation.path,
            }
    raise ValueError("La simulación excedió el máximo de bloques")

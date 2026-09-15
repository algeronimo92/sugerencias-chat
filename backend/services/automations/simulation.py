from domain_types import AutomationBuilderMode, AutomationExecutionStatus, FlowNodeType
from services.automations.common import (
    MAX_FLOW_NODES,
    _flow_indexes,
)
from services.automations.conditions import (
    _matches_condition_values,
)
from services.automations.flow_nodes import (
    FlowSimulation,
    _flow_node_handler,
)
from services.automations.flow_validation import (
    validate_visual_flow,
)
from services.automations.rules import (
    get_automation_rule,
)
from services.db_service import fetch_chat


async def simulate_visual_flow(rule_id: int, lead_id: str) -> dict:
    current = await get_automation_rule(rule_id)
    if current is None or current["builder_mode"] != AutomationBuilderMode.VISUAL:
        raise ValueError("Flujo visual no encontrado")
    validated = await validate_visual_flow(
        current["name"], current["flow_definition"], current_rule_id=rule_id,
    )
    chat = await fetch_chat(lead_id)
    if not chat:
        raise ValueError("Lead no encontrado")
    matches, reason = await _matches_condition_values(validated["conditions"], chat, rule_id)
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
    nodes, edges = _flow_indexes(validated["flow_definition"])
    trigger = next(
        node for node in nodes.values() if node["type"] == FlowNodeType.TRIGGER
    )
    current_id = trigger["id"]
    simulation = FlowSimulation(rule_id=rule_id, chat=chat, edges=edges, path=[])
    for _ in range(MAX_FLOW_NODES + 1):
        node = nodes[current_id]
        current_id = await _flow_node_handler(node["type"]).simulate(node, simulation)
        if current_id is None:
            return {
                "lead_id": chat["chat_id"], "lead_name": chat.get("name"),
                "flow_version": current["flow_version"], "path": simulation.path,
            }
    raise ValueError("La simulación excedió el máximo de bloques")

"""Cómo corre y cómo se simula cada bloque de un flujo visual.

Un handler por tipo de bloque (``FLOW_NODE_HANDLERS``). La forma de cada
bloque al guardarlo vive en ``domain.flow_definition``.
"""

from __future__ import annotations

import dataclasses
from datetime import datetime, timedelta, timezone

from domain_types import (
    AutomationActionType,
    AutomationExecutionStatus,
    FlowHandle,
    FlowNodeType,
    QuestionHandle,
    WaitAnyConditionKind,
)

from app.modules.automations.application.actions import (
    execute_action,
    require_service_window,
    send_buttons_message,
    with_outbox_dedupe,
)
from app.modules.automations.application.conditions import matches_condition_node
from app.modules.automations.application.deps import AutomationDeps
from app.modules.automations.domain.events import AutomationsChanged
from app.modules.automations.domain.execution import child_flow_payload, require_invocable
from app.modules.automations.domain.rules import business_timezone, is_business_hours, render_variables, wait_seconds


async def start_invoked_flow(
    parent_execution,
    flow_rule_id: int,
    node_id: str,
    deps: AutomationDeps,
) -> tuple[int, str]:
    """Programa una ejecución hija para el mismo lead y devuelve id/nombre.

    La ejecución es independiente: si el hijo contiene una pausa puede quedar
    esperando sin retener al padre.
    """
    payload = child_flow_payload(parent_execution, flow_rule_id)
    target = await deps.executions.rule(flow_rule_id)
    require_invocable(target)
    child_id = await deps.executions.schedule_child(
        rule=target, parent=parent_execution, event_key=f"flow:{parent_execution.id}:{node_id}",
        payload=payload, now=deps.now(),
    )
    if child_id is None:
        raise ValueError("No se pudo recuperar la ejecución del flujo hijo")
    await deps.publish(AutomationsChanged(wake=True))
    return child_id, target.name


@dataclasses.dataclass
class FlowRun:
    execution: object
    rule: object
    chat: dict
    deps: AutomationDeps
    state: dict
    edges: dict
    results: list[dict]
    message_context: dict

    def record(self, node_id: str | None, **fields) -> None:
        self.results.append({"position": len(self.results) + 1, "node_id": node_id, **fields})

    def waiting_at(self, node_id: str) -> bool:
        return self.state.get("waiting_at_node") == node_id


@dataclasses.dataclass
class FlowSimulation:
    rule_id: int
    chat: dict
    edges: dict
    path: list[dict]
    deps: AutomationDeps

    def record(self, node_id: str | None, **fields) -> None:
        self.path.append({"node_id": node_id, **fields})


@dataclasses.dataclass(frozen=True)
class NodeOutcome:
    status: AutomationExecutionStatus
    next_node_id: str | None = None
    scheduled_for: datetime | None = None
    wait_state: dict | None = None


def _advance(next_node_id: str) -> NodeOutcome:
    return NodeOutcome(AutomationExecutionStatus.RUNNING, next_node_id)


def _suspend(node_id: str | None, seconds: int, wait_state: dict | None = None) -> NodeOutcome:
    return NodeOutcome(
        AutomationExecutionStatus.SCHEDULED, node_id,
        datetime.now(timezone.utc) + timedelta(seconds=seconds), wait_state,
    )


_COMPLETED = NodeOutcome(AutomationExecutionStatus.COMPLETED)


class FlowNodeHandler:
    def failure_type(self, node: dict) -> str:
        return "flow"


class TriggerNode(FlowNodeHandler):
    async def execute(self, node: dict, run: FlowRun) -> NodeOutcome:
        return _advance(run.edges[(node["id"], FlowHandle.NEXT)])

    async def simulate(self, node: dict, simulation: FlowSimulation) -> str | None:
        simulation.record(node["id"], type=FlowNodeType.TRIGGER, status="matched")
        return simulation.edges[(node["id"], FlowHandle.NEXT)]


class ConditionNode(FlowNodeHandler):
    async def execute(self, node: dict, run: FlowRun) -> NodeOutcome:
        _matches, branch, detail = await matches_condition_node(
            node["data"], run.chat, run.deps, run.message_context,
        )
        run.record(
            node["id"], type=FlowNodeType.CONDITION, status=AutomationExecutionStatus.COMPLETED,
            branch=branch, detail=detail,
        )
        return _advance(run.edges[(node["id"], branch)])

    async def simulate(self, node: dict, simulation: FlowSimulation) -> str | None:
        chat = simulation.chat
        simulation_message = chat.get("last_message") if chat.get("last_message_sender") == "cliente" else None
        _matches, branch, detail = await matches_condition_node(
            node["data"], chat, simulation.deps, {"content": simulation_message},
        )
        simulation.record(node["id"], type=FlowNodeType.CONDITION, status="evaluated", branch=branch, detail=detail)
        return simulation.edges[(node["id"], branch)]


class ActionNode(FlowNodeHandler):
    def failure_type(self, node: dict) -> str:
        return node["data"].get("action", {}).get("type", FlowNodeType.ACTION)

    async def execute(self, node: dict, run: FlowRun) -> NodeOutcome:
        result = await execute_action(
            node["data"]["action"], run.chat, run.execution, run.rule, run.deps, position=len(run.results) + 1,
        )
        run.record(node["id"], **result)
        return _advance(run.edges[(node["id"], FlowHandle.NEXT)])

    async def simulate(self, node: dict, simulation: FlowSimulation) -> str | None:
        action = node["data"]["action"]
        result = {"type": action["type"], "status": "would_run"}
        if action["type"] == AutomationActionType.SEND_TEMPLATE:
            window = await simulation.deps.get_customer_service_window(simulation.chat["chat_id"])
            if not window or not window["is_open"]:
                result.update(status="would_fail", detail="La ventana de 24 horas está cerrada")
        simulation.record(node["id"], **result)
        return simulation.edges[(node["id"], FlowHandle.NEXT)]


class InvokeFlowNode(FlowNodeHandler):
    def failure_type(self, node: dict) -> str:
        return FlowNodeType.INVOKE_FLOW

    async def execute(self, node: dict, run: FlowRun) -> NodeOutcome:
        flow_rule_id = int(node["data"]["flow_rule_id"])
        child_id, target_name = await start_invoked_flow(run.execution, flow_rule_id, node["id"], run.deps)
        run.record(
            node["id"], type=FlowNodeType.INVOKE_FLOW, status=AutomationExecutionStatus.COMPLETED,
            flow_rule_id=flow_rule_id, child_execution_id=child_id, detail=f"Flujo hijo iniciado: {target_name}",
        )
        return _advance(run.edges[(node["id"], FlowHandle.NEXT)])

    async def simulate(self, node: dict, simulation: FlowSimulation) -> str | None:
        target_id = int(node["data"]["flow_rule_id"])
        target = await simulation.deps.executions.rule(target_id)
        simulation.record(
            node["id"], type=FlowNodeType.INVOKE_FLOW, status="would_run",
            detail=f"Iniciaría el flujo hijo: {target.name if target else f'#{target_id}'}",
        )
        return simulation.edges[(node["id"], FlowHandle.NEXT)]


class WaitNode(FlowNodeHandler):
    async def execute(self, node: dict, run: FlowRun) -> NodeOutcome:
        seconds = wait_seconds(node["data"])
        run.record(node["id"], type=FlowNodeType.WAIT, status=AutomationExecutionStatus.SCHEDULED, seconds=seconds)
        return _suspend(run.edges[(node["id"], FlowHandle.NEXT)], seconds)

    async def simulate(self, node: dict, simulation: FlowSimulation) -> str | None:
        simulation.record(node["id"], type=FlowNodeType.WAIT, status="would_wait", seconds=wait_seconds(node["data"]))
        return simulation.edges[(node["id"], FlowHandle.NEXT)]


class WaitAnyNode(FlowNodeHandler):
    async def execute(self, node: dict, run: FlowRun) -> NodeOutcome:
        conditions = node["data"]["conditions"]
        if not run.waiting_at(node["id"]):
            # Primera llegada: no se sabe todavía qué rama seguir, así que a
            # diferencia de Wait acá NO se avanza — se pausa en este mismo
            # bloque hasta que pase algo (el temporizador cumple, llega un
            # mensaje o se reproduce lo último que se le mandó).
            timer = next(c for c in conditions if c["kind"] == WaitAnyConditionKind.TIMER)
            awaiting = [
                c["kind"] for c in conditions
                if c["kind"] in {WaitAnyConditionKind.MESSAGE, WaitAnyConditionKind.MEDIA_RECEIVED}
            ]
            has_media_played = any(c["kind"] == WaitAnyConditionKind.MEDIA_PLAYED for c in conditions)
            # Lo que se vigila para saber cuándo lo reproduce: el último
            # adjunto que el vendedor le mandó. Si todavía no le mandó ninguno
            # la condición simplemente nunca se cumple.
            watching_message_id = (
                await run.deps.latest_outbound_media_wa_id(run.chat["chat_id"]) if has_media_played else None
            )
            run.record(
                node["id"], type=FlowNodeType.WAIT_ANY, status=AutomationExecutionStatus.SCHEDULED,
                conditions=conditions,
            )
            return _suspend(node["id"], timer["seconds"], {
                "waiting_at_node": node["id"],
                # ISO plano porque el barrido de respuestas lo vuelve a
                # parsear con datetime.fromisoformat.
                "waiting_since": datetime.now(timezone.utc).isoformat(),
                "awaiting": awaiting,
                "watching_message_id": watching_message_id,
            })
        # "Excepto horas laborales" tiene prioridad sobre cualquier otra rama.
        branch = run.state.get("resume_reason") or WaitAnyConditionKind.TIMER
        has_business_hours = any(c["kind"] == WaitAnyConditionKind.BUSINESS_HOURS for c in conditions)
        if has_business_hours and not is_business_hours(datetime.now(business_timezone())):
            branch = WaitAnyConditionKind.BUSINESS_HOURS
        run.record(node["id"], type=FlowNodeType.WAIT_ANY, status=AutomationExecutionStatus.COMPLETED, branch=branch)
        next_id = run.edges.get((node["id"], branch))
        if next_id is None:
            # Solo la rama del temporizador puede llegar sin conexión: el
            # flujo termina acá, igual que en un bloque Fin.
            run.record(None, type=FlowNodeType.END, status=AutomationExecutionStatus.COMPLETED)
            return _COMPLETED
        return _advance(next_id)

    async def simulate(self, node: dict, simulation: FlowSimulation) -> str | None:
        # No hay forma de simular qué condición se cumpliría primero: se sigue
        # por la rama del temporizador, que es opcional.
        simulation.record(
            node["id"], type=FlowNodeType.WAIT_ANY, status="would_wait",
            conditions=node["data"].get("conditions", []),
        )
        next_id = simulation.edges.get((node["id"], WaitAnyConditionKind.TIMER))
        if next_id is None:
            simulation.record(None, type=FlowNodeType.END, status=AutomationExecutionStatus.COMPLETED)
        return next_id


class QuestionNode(FlowNodeHandler):
    async def execute(self, node: dict, run: FlowRun) -> NodeOutcome:
        if run.waiting_at(node["id"]):
            # resume_reason es un id de botón, "other" o, si no está, "timeout".
            branch = run.state.get("resume_reason") or QuestionHandle.TIMEOUT
            run.record(node["id"], type=FlowNodeType.QUESTION, status=AutomationExecutionStatus.COMPLETED, branch=branch)
            return _advance(run.edges[(node["id"], branch)])
        text = render_variables(node["data"]["text"], run.chat).strip()
        buttons_data = node["data"]["buttons"]
        if not text:
            raise ValueError("La pregunta no tiene contenido para enviar")
        await require_service_window(run.chat, run.execution, run.deps)
        buttons = [{"id": button["id"], "title": button["label"]} for button in buttons_data]
        message = await send_buttons_message(
            run.chat, text, buttons, with_outbox_dedupe(run.deps, run.execution.id, len(run.results) + 1),
        )
        run.record(
            node["id"], type=FlowNodeType.QUESTION, status=AutomationExecutionStatus.SCHEDULED,
            message_ids=[message["id"]],
        )
        return _suspend(node["id"], node["data"]["timeout_seconds"], {
            "waiting_at_node": node["id"],
            "waiting_since": datetime.now(timezone.utc).isoformat(),
            # La salida "mandó la foto" es opcional: sólo se espera como rama
            # propia si el flujo la conectó.
            "awaiting": (
                [WaitAnyConditionKind.MESSAGE, WaitAnyConditionKind.MEDIA_RECEIVED]
                if (node["id"], QuestionHandle.MEDIA) in run.edges
                else [WaitAnyConditionKind.MESSAGE]
            ),
            "question_buttons": buttons_data,
        })

    async def simulate(self, node: dict, simulation: FlowSimulation) -> str | None:
        simulation.record(
            node["id"], type=FlowNodeType.QUESTION, status="would_wait",
            text=node["data"].get("text"), buttons=node["data"].get("buttons", []),
        )
        return simulation.edges[(node["id"], QuestionHandle.TIMEOUT)]


class RoundRobinNode(FlowNodeHandler):
    async def execute(self, node: dict, run: FlowRun) -> NodeOutcome:
        # El módulo se aplica al leer y no al guardar: así cambiar la cantidad
        # de salidas al republicar no obliga a reiniciar el contador.
        outputs = node["data"]["outputs"]
        counter = await run.deps.executions.advance_round_robin(run.rule.id, node["id"], run.deps.now())
        output = outputs[(int(counter or 1) - 1) % len(outputs)]
        run.record(
            node["id"], type=FlowNodeType.ROUND_ROBIN, status=AutomationExecutionStatus.COMPLETED,
            branch=output["id"], detail=f"Turno: {output['label']}",
        )
        return _advance(run.edges[(node["id"], output["id"])])

    async def simulate(self, node: dict, simulation: FlowSimulation) -> str | None:
        # Sin gastar el turno: simular no debe correr el reparto.
        outputs = node["data"]["outputs"]
        counter = await simulation.deps.executions.round_robin_counter(simulation.rule_id, node["id"])
        output = outputs[int(counter or 0) % len(outputs)]
        simulation.record(
            node["id"], type=FlowNodeType.ROUND_ROBIN, status="evaluated",
            branch=output["id"], detail=f"Le tocaría el turno a: {output['label']}",
        )
        return simulation.edges[(node["id"], output["id"])]


class EndNode(FlowNodeHandler):
    async def execute(self, node: dict, run: FlowRun) -> NodeOutcome:
        if node["data"].get("close_conversation") is True:
            close_result = await execute_action(
                {"type": AutomationActionType.SET_CONVERSATION_STATE, "state": "closed"},
                run.chat, run.execution, run.rule, run.deps, position=len(run.results) + 1,
            )
            run.record(node["id"], **close_result)
        run.record(node["id"], type=FlowNodeType.END, status=AutomationExecutionStatus.COMPLETED)
        return _COMPLETED

    async def simulate(self, node: dict, simulation: FlowSimulation) -> str | None:
        if node["data"].get("close_conversation") is True:
            simulation.record(
                node["id"], type=AutomationActionType.SET_CONVERSATION_STATE, status="would_run",
                detail="Cerraría la conversación",
            )
        simulation.record(node["id"], type=FlowNodeType.END, status=AutomationExecutionStatus.COMPLETED)
        return None


FLOW_NODE_HANDLERS: dict[FlowNodeType, FlowNodeHandler] = {
    FlowNodeType.TRIGGER: TriggerNode(),
    FlowNodeType.CONDITION: ConditionNode(),
    FlowNodeType.ACTION: ActionNode(),
    FlowNodeType.INVOKE_FLOW: InvokeFlowNode(),
    FlowNodeType.WAIT: WaitNode(),
    FlowNodeType.WAIT_ANY: WaitAnyNode(),
    FlowNodeType.QUESTION: QuestionNode(),
    FlowNodeType.ROUND_ROBIN: RoundRobinNode(),
    FlowNodeType.END: EndNode(),
}


def flow_node_handler(node_type: str) -> FlowNodeHandler:
    return FLOW_NODE_HANDLERS.get(node_type, FLOW_NODE_HANDLERS[FlowNodeType.END])

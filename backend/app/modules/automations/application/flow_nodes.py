"""Cómo corre y cómo se simula cada bloque de un flujo visual.

Un handler por tipo de bloque (``FLOW_NODE_HANDLERS``). La forma de cada
bloque al guardarlo vive en ``domain.flow_definition``.
"""

from __future__ import annotations

import dataclasses
from datetime import datetime, timedelta, timezone

from app.modules.automations.domain.types import AutomationActionType, AutomationExecutionStatus, FlowHandle, FlowNodeType, QuestionHandle, WaitAnyConditionKind

from app.modules.automations.application.actions import (
    SERVICE_WINDOW_ACTIONS,
    execute_action,
    require_service_window,
    send_buttons_message,
    with_outbox_dedupe,
)
from app.modules.automations.application.conditions import matches_condition_node
from app.modules.automations.application.deps import AutomationDeps
from app.modules.automations.domain.events import AutomationsChanged
from app.modules.automations.domain.execution import child_flow_payload, require_invocable
from app.modules.automations.domain.rules import render_variables, wait_seconds
from app.modules.automations.domain.templates import automatic_template_problem, is_official, quick_reply_labels, reply_buttons_now
from app.modules.automations.domain.errors import StepFailed


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
        raise StepFailed("No se pudo recuperar la ejecución de la automatización lanzada")
    await deps.publish(AutomationsChanged(wake=True))
    return child_id, target.name


# Cuánto tiempo atrás se mira antes de que un flujo inicie a otro. En
# DermicaPro, «Bienvenida» espera 15 s antes de iniciar la secuencia del
# servicio; en 16 de 4.865 envíos de noviembre de 2026 la vendedora lanzó esa
# misma secuencia a mano dentro de esos segundos y el cliente la recibió dos
# veces seguidas. Media hora cubre también a quien responde un chat que
# Bienvenida todavía no atendió.
INVOKED_FLOW_REPEAT_WINDOW = timedelta(minutes=30)


async def already_started_for_lead(
    parent_execution, flow_rule_id: int, node_id: str, deps: AutomationDeps,
) -> str | None:
    """Motivo para no iniciar el flujo hijo, si ese mismo flujo ya se le inició
    a este lead hace poco por otro camino. Solo frena lo que inicia un flujo:
    quien lo lanza desde el chat siempre puede repetirlo."""
    if not parent_execution.lead_id:
        return None
    source = await deps.executions.started_for_lead_since(
        flow_rule_id, parent_execution.lead_id, deps.now() - INVOKED_FLOW_REPEAT_WINDOW,
        exclude_event_key=f"flow:{parent_execution.id}:{node_id}",
    )
    if source is None:
        return None
    target = await deps.executions.rule(flow_rule_id)
    name = target.name if target else f"#{flow_rule_id}"
    who = "tu equipo ya la lanzó desde el chat" if source == "manual" else "ya se le lanzó a este cliente"
    return f"No se repitió «{name}»: {who} hace menos de 30 minutos"


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


_WINDOW_CLOSED_DETAIL = "La ventana de 24 horas está cerrada"


async def _service_window_closed(simulation: FlowSimulation) -> bool:
    window = await simulation.deps.get_customer_service_window(simulation.chat["chat_id"])
    return not window or not window["is_open"]


class ActionNode(FlowNodeHandler):
    def failure_type(self, node: dict) -> str:
        return node["data"].get("action", {}).get("type", FlowNodeType.ACTION)

    async def execute(self, node: dict, run: FlowRun) -> NodeOutcome:
        action = node["data"]["action"]
        # Solo Enviar plantilla lo lleva: sigue según el botón que toque el cliente.
        reply = node["data"].get("reply")
        if reply and run.waiting_at(node["id"]):
            # resume_reason es el id de un botón u "other"; si no está, venció
            # el tiempo. Una salida sin conexión (un botón que la plantilla
            # sumó después de publicar) sigue por «Otra respuesta».
            branch = run.state.get("resume_reason") or QuestionHandle.TIMEOUT
            if (node["id"], branch) not in run.edges:
                branch = QuestionHandle.OTHER
            # El texto del botón queda en el paso: «btn_2» no le dice nada a
            # quien lee el historial, y sin el flujo a mano no se puede traducir.
            label = next(
                (button["label"] for button in run.state.get("question_buttons") or [] if button["id"] == branch), None,
            )
            run.record(
                node["id"], type=action["type"], status=AutomationExecutionStatus.COMPLETED, branch=branch,
                **({"branch_label": label} if label else {}),
            )
            return _advance(run.edges[(node["id"], branch)])
        # Los botones que la plantilla tiene hoy se leen antes de enviarla: si
        # la lectura fallara después, el reintento la mandaría dos veces.
        buttons = (
            reply_buttons_now(reply["buttons"], quick_reply_labels(await run.deps.load_template(action["template_id"])))
            if reply else None
        )
        result = await execute_action(
            action, run.chat, run.execution, run.rule, run.deps, position=len(run.results) + 1,
        )
        run.record(node["id"], **result)
        if not reply:
            return _advance(run.edges[(node["id"], FlowHandle.NEXT)])
        # La plantilla ya salió: el paso queda esperando acá mismo, con el
        # mismo estado que deja una Pregunta, así que el barrido de respuestas
        # del worker lo reanuda sin saber que es una plantilla. El toque de un
        # botón de plantilla llega como texto (no trae un id nuestro), y se
        # reconoce por ese texto.
        return _suspend(node["id"], reply["timeout_seconds"], {
            "waiting_at_node": node["id"],
            "waiting_since": datetime.now(timezone.utc).isoformat(),
            "awaiting": [WaitAnyConditionKind.MESSAGE],
            "question_buttons": buttons,
            "reply_by_number": False,
        })

    async def simulate(self, node: dict, simulation: FlowSimulation) -> str | None:
        action = node["data"]["action"]
        reply = node["data"].get("reply")
        result = {"type": action["type"], "status": "would_run"}
        needs_window = action["type"] in SERVICE_WINDOW_ACTIONS
        if action["type"] == AutomationActionType.SEND_TEMPLATE:
            template = await simulation.deps.load_template(action["template_id"])
            problem = automatic_template_problem(template)
            if problem:
                result.update(status="would_fail", detail=problem)
                needs_window = False
            elif is_official(template):
                result.update(detail="Plantilla de Meta: se envía aunque la ventana de 24 horas esté cerrada")
                needs_window = False
        if needs_window and await _service_window_closed(simulation):
            result.update(status="would_fail", detail=_WINDOW_CLOSED_DETAIL)
        if not reply:
            simulation.record(node["id"], **result)
            return simulation.edges[(node["id"], FlowHandle.NEXT)]
        # No se puede saber qué botón tocaría: sigue por «Sin respuesta», como la Pregunta.
        simulation.record(node["id"], **result, branch=QuestionHandle.TIMEOUT)
        return simulation.edges[(node["id"], QuestionHandle.TIMEOUT)]


class InvokeFlowNode(FlowNodeHandler):
    def failure_type(self, node: dict) -> str:
        return FlowNodeType.INVOKE_FLOW

    async def execute(self, node: dict, run: FlowRun) -> NodeOutcome:
        flow_rule_id = int(node["data"]["flow_rule_id"])
        repeated = await already_started_for_lead(run.execution, flow_rule_id, node["id"], run.deps)
        if repeated:
            run.record(
                node["id"], type=FlowNodeType.INVOKE_FLOW, status=AutomationExecutionStatus.SKIPPED,
                flow_rule_id=flow_rule_id, detail=repeated,
            )
            return _advance(run.edges[(node["id"], FlowHandle.NEXT)])
        child_id, target_name = await start_invoked_flow(run.execution, flow_rule_id, node["id"], run.deps)
        run.record(
            node["id"], type=FlowNodeType.INVOKE_FLOW, status=AutomationExecutionStatus.COMPLETED,
            flow_rule_id=flow_rule_id, child_execution_id=child_id, detail=f"Automatización lanzada: {target_name}",
        )
        return _advance(run.edges[(node["id"], FlowHandle.NEXT)])

    async def simulate(self, node: dict, simulation: FlowSimulation) -> str | None:
        target_id = int(node["data"]["flow_rule_id"])
        target = await simulation.deps.executions.rule(target_id)
        simulation.record(
            node["id"], type=FlowNodeType.INVOKE_FLOW, status="would_run",
            detail=f"Lanzaría la automatización: {target.name if target else f'#{target_id}'}",
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
        if has_business_hours and not (await run.deps.business_hours()).contains(run.deps.now()):
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
            raise StepFailed("La pregunta no tiene contenido para enviar")
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
        # La pregunta se manda como mensaje de botones: con la ventana
        # cerrada falla igual que cualquier envío (ver execute).
        closed = await _service_window_closed(simulation)
        simulation.record(
            node["id"], type=FlowNodeType.QUESTION, status="would_fail" if closed else "would_wait",
            text=node["data"].get("text"), buttons=node["data"].get("buttons", []),
            **({"detail": _WINDOW_CLOSED_DETAIL} if closed else {}),
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

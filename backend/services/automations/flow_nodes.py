import dataclasses
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from db.models import AutomationExecution, AutomationRule
from domain_types import (
    AutomationActionType,
    AutomationBuilderMode,
    AutomationExecutionStatus,
    AutomationTrigger,
    FlowHandle,
    FlowNodeType,
    QuestionHandle,
    WaitAnyConditionKind,
)
from services.automation_deps import DEFAULT_DEPS, AutomationDeps
from services.automation_rules import business_timezone, is_business_hours
from services.automations.actions import (
    _execute_action,
    _last_outbound_media_message_id,
    _require_service_window,
    _send_buttons_message,
    _with_outbox_dedupe,
)
from services.automations.common import (
    _render,
    _wait_seconds,
    _wake,
)
from services.automations.conditions import (
    _execution_message_context,
    _matches_flow_condition_node,
)
from services.automations.round_robin import (
    _next_round_robin_output,
    _peek_round_robin_output,
)
from services.automations.rule_validation import (
    _normalize_flow_condition_node,
    _normalize_question,
    _normalize_round_robin,
    _normalize_wait_any_conditions,
    validate_automation_rule,
)
from services.automations.rules import (
    get_automation_rule,
)
from services.db_service import get_customer_service_window


async def _start_invoked_flow(
    parent_execution: AutomationExecution,
    flow_rule_id: int,
    node_id: str,
    deps: AutomationDeps = DEFAULT_DEPS,
) -> tuple[int, str]:
    """Programa una ejecución hija para el mismo lead y devuelve id/nombre.

    La ejecución es independiente: si el hijo contiene una pausa puede quedar
    esperando sin retener al padre. La ascendencia viaja en event_payload para
    frenar ciclos incluso si una definición antigua eludió la validación de
    publicación.
    """
    payload = parent_execution.event_payload or {}
    ancestry = [int(item) for item in (payload.get("flow_ancestry") or [])]
    ancestry.append(parent_execution.rule_id)
    if flow_rule_id in ancestry:
        raise ValueError("La invocación entre flujos contiene un ciclo")
    if len(ancestry) >= 20:
        raise ValueError("La cadena de flujos invocados es demasiado profunda")
    message_context = _execution_message_context(parent_execution)
    child_payload = {
        "parent_execution_id": parent_execution.id,
        "parent_rule_id": parent_execution.rule_id,
        "flow_ancestry": ancestry,
    }
    if message_context.get("content") is not None:
        child_payload.update(message_context)

    now = deps.now()
    async with deps.session() as session:
        target = await session.get(AutomationRule, flow_rule_id)
        if target is None or target.deleted_at is not None:
            raise ValueError("El flujo hijo ya no existe")
        if target.builder_mode != AutomationBuilderMode.VISUAL:
            raise ValueError("El destino ya no es un flujo visual")
        if not target.is_active or not target.published_flow_definition:
            raise ValueError(f"El flujo hijo {target.name} no está publicado y activo")
        event_key = f"flow:{parent_execution.id}:{node_id}"
        child_id = (await session.execute(pg_insert(AutomationExecution).values(
            rule_id=target.id,
            lead_id=parent_execution.lead_id,
            trigger_type=target.trigger_type,
            event_key=event_key,
            event_payload=child_payload,
            status=AutomationExecutionStatus.SCHEDULED,
            scheduled_for=now,
            action_results=[],
            flow_state={
                "flow_version": target.flow_version,
                "current_node_id": None,
                "path": [],
            },
            created_at=now,
            start_source="flow",
            started_by_user_id=parent_execution.started_by_user_id,
        ).on_conflict_do_nothing(
            index_elements=[AutomationExecution.rule_id, AutomationExecution.event_key]
        ).returning(AutomationExecution.id))).scalar_one_or_none()
        if child_id is None:
            child_id = await session.scalar(select(AutomationExecution.id).where(
                AutomationExecution.rule_id == target.id,
                AutomationExecution.event_key == event_key,
            ))
        if child_id is None:
            raise ValueError("No se pudo recuperar la ejecución del flujo hijo")
        target_name = target.name
        await session.commit()
    await deps.broadcast({"type": "automations_updated"})
    _wake.set()
    return child_id, target_name


@dataclasses.dataclass
class FlowValidationFacts:
    trigger_nodes: list[dict] = dataclasses.field(default_factory=list)
    action_nodes: list[tuple[int, dict]] = dataclasses.field(default_factory=list)
    invoke_flow_nodes: list[tuple[int, int]] = dataclasses.field(default_factory=list)
    condition_users: set[int] = dataclasses.field(default_factory=set)
    condition_tags: set[int] = dataclasses.field(default_factory=set)
    end_count: int = 0


@dataclasses.dataclass(frozen=True)
class FlowNodeRef:
    id: str
    position: int
    index: int


@dataclasses.dataclass
class FlowRun:
    execution: AutomationExecution
    rule: AutomationRule
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
    def dynamic_handles(self, data: dict) -> set[str]:
        return set()

    def failure_type(self, node: dict) -> str:
        return "flow"


class TriggerNode(FlowNodeHandler):
    async def normalize(self, name: str, data: dict, ref: FlowNodeRef, facts: FlowValidationFacts) -> dict:
        trigger_type = data.get("trigger_type")
        trigger_config = (
            {"minutes": data.get("minutes")}
            if trigger_type in {
                AutomationTrigger.SELLER_RESPONSE_OVERDUE,
                AutomationTrigger.CUSTOMER_RESPONSE_OVERDUE,
            }
            else {}
        )
        trigger_values = await validate_automation_rule({
            "name": name, "trigger_type": trigger_type, "trigger_config": trigger_config,
            "conditions": {},
            "actions": [{"type": AutomationActionType.CHANGE_STAGE, "stage": "nuevo"}],
            "delay_minutes": 0, "is_active": False,
        })
        normalized = {
            "trigger_type": trigger_values["trigger_type"],
            "minutes": trigger_values["trigger_config"].get("minutes"),
        }
        facts.trigger_nodes.append({"id": ref.id, "data": normalized})
        return normalized

    async def execute(self, node: dict, run: FlowRun) -> NodeOutcome:
        return _advance(run.edges[(node["id"], FlowHandle.NEXT)])

    async def simulate(self, node: dict, simulation: FlowSimulation) -> str | None:
        simulation.record(node["id"], type=FlowNodeType.TRIGGER, status="matched")
        return simulation.edges[(node["id"], FlowHandle.NEXT)]


class ConditionNode(FlowNodeHandler):
    def dynamic_handles(self, data: dict) -> set[str]:
        return {
            group["id"]
            for group in (data.get("condition_groups") or [])
            if isinstance(group, dict) and isinstance(group.get("id"), str)
        }

    async def normalize(self, name: str, data: dict, ref: FlowNodeRef, facts: FlowValidationFacts) -> dict:
        normalized, user_ids, tag_ids = _normalize_flow_condition_node(data, ref.position)
        facts.condition_users.update(user_ids)
        facts.condition_tags.update(tag_ids)
        return normalized

    async def execute(self, node: dict, run: FlowRun) -> NodeOutcome:
        _matches, branch, detail = await _matches_flow_condition_node(
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
        _matches, branch, detail = await _matches_flow_condition_node(
            node["data"], chat, message_context={"content": simulation_message},
        )
        simulation.record(node["id"], type=FlowNodeType.CONDITION, status="evaluated", branch=branch, detail=detail)
        return simulation.edges[(node["id"], branch)]


class ActionNode(FlowNodeHandler):
    def failure_type(self, node: dict) -> str:
        return node["data"].get("action", {}).get("type", FlowNodeType.ACTION)

    async def normalize(self, name: str, data: dict, ref: FlowNodeRef, facts: FlowValidationFacts) -> dict:
        action = data.get("action") if isinstance(data.get("action"), dict) else {}
        facts.action_nodes.append((ref.index, action))
        return {"action": action}

    async def execute(self, node: dict, run: FlowRun) -> NodeOutcome:
        result = await _execute_action(
            node["data"]["action"], run.chat, run.execution, run.rule, run.deps, position=len(run.results) + 1,
        )
        run.record(node["id"], **result)
        return _advance(run.edges[(node["id"], FlowHandle.NEXT)])

    async def simulate(self, node: dict, simulation: FlowSimulation) -> str | None:
        action = node["data"]["action"]
        result = {"type": action["type"], "status": "would_run"}
        if action["type"] == AutomationActionType.SEND_TEMPLATE:
            window = await get_customer_service_window(simulation.chat["chat_id"])
            if not window or not window["is_open"]:
                result.update(status="would_fail", detail="La ventana de 24 horas está cerrada")
        simulation.record(node["id"], **result)
        return simulation.edges[(node["id"], FlowHandle.NEXT)]


class InvokeFlowNode(FlowNodeHandler):
    def failure_type(self, node: dict) -> str:
        return FlowNodeType.INVOKE_FLOW

    async def normalize(self, name: str, data: dict, ref: FlowNodeRef, facts: FlowValidationFacts) -> dict:
        flow_rule_id = int(data.get("flow_rule_id") or 0)
        if not flow_rule_id:
            raise ValueError(f"Invocación {ref.position}: selecciona un flujo hijo")
        facts.invoke_flow_nodes.append((ref.index, flow_rule_id))
        return {"flow_rule_id": flow_rule_id}

    async def execute(self, node: dict, run: FlowRun) -> NodeOutcome:
        flow_rule_id = int(node["data"]["flow_rule_id"])
        child_id, target_name = await _start_invoked_flow(run.execution, flow_rule_id, node["id"], run.deps)
        run.record(
            node["id"], type=FlowNodeType.INVOKE_FLOW, status=AutomationExecutionStatus.COMPLETED,
            flow_rule_id=flow_rule_id, child_execution_id=child_id, detail=f"Flujo hijo iniciado: {target_name}",
        )
        return _advance(run.edges[(node["id"], FlowHandle.NEXT)])

    async def simulate(self, node: dict, simulation: FlowSimulation) -> str | None:
        target_id = int(node["data"]["flow_rule_id"])
        target = await get_automation_rule(target_id)
        simulation.record(
            node["id"], type=FlowNodeType.INVOKE_FLOW, status="would_run",
            detail=f"Iniciaría el flujo hijo: {target['name'] if target else f'#{target_id}'}",
        )
        return simulation.edges[(node["id"], FlowHandle.NEXT)]


class WaitNode(FlowNodeHandler):
    async def normalize(self, name: str, data: dict, ref: FlowNodeRef, facts: FlowValidationFacts) -> dict:
        seconds = _wait_seconds(data)
        if not 1 <= seconds <= 604800:
            raise ValueError(f"Espera {ref.position}: configura entre 1 segundo y 7 días")
        return {"seconds": seconds}

    async def execute(self, node: dict, run: FlowRun) -> NodeOutcome:
        seconds = _wait_seconds(node["data"])
        run.record(node["id"], type=FlowNodeType.WAIT, status=AutomationExecutionStatus.SCHEDULED, seconds=seconds)
        return _suspend(run.edges[(node["id"], FlowHandle.NEXT)], seconds)

    async def simulate(self, node: dict, simulation: FlowSimulation) -> str | None:
        simulation.record(node["id"], type=FlowNodeType.WAIT, status="would_wait", seconds=_wait_seconds(node["data"]))
        return simulation.edges[(node["id"], FlowHandle.NEXT)]


class WaitAnyNode(FlowNodeHandler):
    def dynamic_handles(self, data: dict) -> set[str]:
        return {
            condition["kind"]
            for condition in (data.get("conditions") or [])
            if isinstance(condition, dict) and isinstance(condition.get("kind"), str)
        }

    async def normalize(self, name: str, data: dict, ref: FlowNodeRef, facts: FlowValidationFacts) -> dict:
        return _normalize_wait_any_conditions(data, ref.position)

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
            watching_message_id = (
                await _last_outbound_media_message_id(run.chat["chat_id"], run.deps) if has_media_played else None
            )
            run.record(
                node["id"], type=FlowNodeType.WAIT_ANY, status=AutomationExecutionStatus.SCHEDULED,
                conditions=conditions,
            )
            return _suspend(node["id"], timer["seconds"], {
                "waiting_at_node": node["id"],
                # ISO plano porque _discover_wait_any_replies lo vuelve a
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
    def dynamic_handles(self, data: dict) -> set[str]:
        return {
            button["id"]
            for button in (data.get("buttons") or [])
            if isinstance(button, dict) and isinstance(button.get("id"), str)
        } | {QuestionHandle.OTHER, QuestionHandle.TIMEOUT, QuestionHandle.MEDIA}

    async def normalize(self, name: str, data: dict, ref: FlowNodeRef, facts: FlowValidationFacts) -> dict:
        return _normalize_question(data, ref.position)

    async def execute(self, node: dict, run: FlowRun) -> NodeOutcome:
        if run.waiting_at(node["id"]):
            # resume_reason es un id de botón, "other" o, si no está, "timeout".
            branch = run.state.get("resume_reason") or QuestionHandle.TIMEOUT
            run.record(node["id"], type=FlowNodeType.QUESTION, status=AutomationExecutionStatus.COMPLETED, branch=branch)
            return _advance(run.edges[(node["id"], branch)])
        text = _render(node["data"]["text"], run.chat).strip()
        buttons_data = node["data"]["buttons"]
        if not text:
            raise ValueError("La pregunta no tiene contenido para enviar")
        await _require_service_window(run.chat, run.execution, run.deps)
        buttons = [{"type": "reply", "displayText": button["label"], "id": button["id"]} for button in buttons_data]
        message = await _send_buttons_message(
            run.chat, text, buttons, _with_outbox_dedupe(run.deps, run.execution.id, len(run.results) + 1),
        )
        run.record(
            node["id"], type=FlowNodeType.QUESTION, status=AutomationExecutionStatus.SCHEDULED,
            message_ids=[message["id"]],
        )
        await run.deps.broadcast({"type": "chats_updated", "chat_id": run.chat["chat_id"], "reason": "outbound_message"})
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
    def dynamic_handles(self, data: dict) -> set[str]:
        return {
            output["id"]
            for output in (data.get("outputs") or [])
            if isinstance(output, dict) and isinstance(output.get("id"), str)
        }

    async def normalize(self, name: str, data: dict, ref: FlowNodeRef, facts: FlowValidationFacts) -> dict:
        return _normalize_round_robin(data, ref.position)

    async def execute(self, node: dict, run: FlowRun) -> NodeOutcome:
        output = await _next_round_robin_output(run.rule.id, node["id"], node["data"]["outputs"], run.deps)
        run.record(
            node["id"], type=FlowNodeType.ROUND_ROBIN, status=AutomationExecutionStatus.COMPLETED,
            branch=output["id"], detail=f"Turno: {output['label']}",
        )
        return _advance(run.edges[(node["id"], output["id"])])

    async def simulate(self, node: dict, simulation: FlowSimulation) -> str | None:
        # Sin gastar el turno: simular no debe correr el reparto.
        output = await _peek_round_robin_output(simulation.rule_id, node["id"], node["data"]["outputs"])
        simulation.record(
            node["id"], type=FlowNodeType.ROUND_ROBIN, status="evaluated",
            branch=output["id"], detail=f"Le tocaría el turno a: {output['label']}",
        )
        return simulation.edges[(node["id"], output["id"])]


class EndNode(FlowNodeHandler):
    async def normalize(self, name: str, data: dict, ref: FlowNodeRef, facts: FlowValidationFacts) -> dict:
        facts.end_count += 1
        return {
            "label": str(data.get("label") or "Fin").strip()[:80] or "Fin",
            "close_conversation": data.get("close_conversation") is True,
        }

    async def execute(self, node: dict, run: FlowRun) -> NodeOutcome:
        if node["data"].get("close_conversation") is True:
            close_result = await _execute_action(
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


def _flow_node_handler(node_type: str) -> FlowNodeHandler:
    return FLOW_NODE_HANDLERS.get(node_type, FLOW_NODE_HANDLERS[FlowNodeType.END])

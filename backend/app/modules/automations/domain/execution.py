"""Una ejecución de una regla sobre un lead, y las decisiones que el motor
toma sobre ella sin mirar la base: de dónde retoma, quién figura como actor,
qué mensaje la trajo hasta acá y si un flujo hijo se puede invocar.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from app.modules.automations.domain.types import AutomationBuilderMode, AutomationExecutionStatus, AutomationRecipient, AutomationTrigger
from app.modules.automations.domain.errors import StepFailed

TERMINAL_STATUSES = frozenset({
    AutomationExecutionStatus.COMPLETED,
    AutomationExecutionStatus.FAILED,
    AutomationExecutionStatus.SKIPPED,
})

# Más profundo que esto es casi seguro un error de armado, y cada nivel es una
# ejecución más corriendo sobre el mismo lead.
MAX_FLOW_INVOCATION_DEPTH = 20


@dataclass
class Rule:
    id: int
    name: str
    trigger_type: str
    is_active: bool = True
    builder_mode: str = AutomationBuilderMode.SIMPLE
    conditions: dict = field(default_factory=dict)
    actions: list = field(default_factory=list)
    flow_version: int = 0
    published_flow_definition: dict | None = None
    max_executions_per_hour: int | None = None
    created_by_user_id: int | None = None
    deleted_at: datetime | None = None


@dataclass
class Execution:
    id: int
    rule_id: int
    lead_id: str | None
    trigger_type: str
    status: str = AutomationExecutionStatus.SCHEDULED
    event_payload: dict = field(default_factory=dict)
    flow_state: dict = field(default_factory=dict)
    action_results: list = field(default_factory=list)
    started_by_user_id: int | None = None
    window_override_by_user_id: int | None = None
    start_source: str = "system"
    error: str | None = None


def resumable_results(results: list[dict]) -> list[dict]:
    """Lo ya hecho que un reintento conserva: todo salvo lo que falló."""
    return [
        result for result in results
        if result.get("status") != AutomationExecutionStatus.FAILED
    ]


def execution_actor(execution: Any) -> tuple[str, int | None]:
    """Actor humano que originó una acción del motor.

    Los flujos manuales y sus flujos hijos conservan al vendedor iniciador.
    Un disparador automático no se atribuye al creador de la regla: el actor
    real es el sistema.
    """
    user_id = getattr(execution, "started_by_user_id", None)
    return ("user", user_id) if user_id is not None else ("system", None)


def resolve_recipient(action: dict, chat: dict, payload: dict) -> int:
    if (
        action.get("recipient") == AutomationRecipient.SPECIFIC
        and action.get("user_id")
    ):
        return int(action["user_id"])
    if chat.get("vendedor_id"):
        return int(chat["vendedor_id"])
    if payload.get("assigned_user_id"):
        return int(payload["assigned_user_id"])
    raise StepFailed("El lead no tiene vendedor asignado")


def execution_message_context(execution: Any) -> dict:
    """El mensaje del cliente que trajo la ejecución hasta el nodo actual: el
    que la reanudó de una pausa si lo hubo, y si no el que la disparó.

    Los campos del contrato (`message_type`, `message_subtype`, `reply_id`)
    pueden faltar en ejecuciones creadas antes de que se guardaran, así que
    toda condición que dependa de ellos tiene que tolerar que falten."""
    state = execution.flow_state or {}
    resumed_message = state.get("message_context")
    if isinstance(resumed_message, dict) and "content" in resumed_message:
        source = resumed_message
    else:
        # Un flujo invocado recibe el contexto del padre en su event_payload,
        # así que las condiciones sobre el mensaje también funcionan ahí.
        source = execution.event_payload or {}
    return {
        field: source.get(field)
        for field in ("message_id", "content", "message_type", "message_subtype", "reply_id", "analysis_summary")
    }


def child_flow_payload(parent: Any, flow_rule_id: int) -> dict:
    """El event_payload de un flujo hijo. La ascendencia viaja en él para
    frenar ciclos incluso si una definición antigua eludió la validación de
    publicación."""
    payload = parent.event_payload or {}
    ancestry = [int(item) for item in (payload.get("flow_ancestry") or [])]
    ancestry.append(parent.rule_id)
    if flow_rule_id in ancestry:
        raise StepFailed("La invocación entre flujos contiene un ciclo")
    if len(ancestry) >= MAX_FLOW_INVOCATION_DEPTH:
        raise StepFailed("La cadena de flujos invocados es demasiado profunda")
    message_context = execution_message_context(parent)
    child_payload = {
        "parent_execution_id": parent.id,
        "parent_rule_id": parent.rule_id,
        "flow_ancestry": ancestry,
    }
    if message_context.get("content") is not None:
        child_payload.update(message_context)
    return child_payload


def require_invocable(target: Any) -> None:
    if target is None or target.deleted_at is not None:
        raise StepFailed("El flujo hijo ya no existe")
    if target.builder_mode != AutomationBuilderMode.VISUAL:
        raise StepFailed("El destino ya no es un flujo visual")
    if not target.is_active or not target.published_flow_definition:
        raise StepFailed(f"El flujo hijo {target.name} no está publicado y activo")


def initial_flow_state(builder_mode: str, flow_version: int) -> dict:
    """El estado con el que arranca una ejecución: los flujos visuales fijan
    la versión publicada que van a recorrer."""
    if builder_mode != AutomationBuilderMode.VISUAL:
        return {}
    return {"flow_version": flow_version, "current_node_id": None, "path": []}


def deadline_already_fired(execution: Any) -> bool:
    """Una ejecución por silencio del cliente que ya empezó a recorrer el flujo
    (quedó SCHEDULED por un nodo de espera) no vuelve a validarse ni se cancela
    por mensajes que son parte del propio flujo."""
    if getattr(execution, "trigger_type", None) != AutomationTrigger.CUSTOMER_RESPONSE_OVERDUE:
        return True
    flow_state = getattr(execution, "flow_state", None) or {}
    return bool(
        getattr(execution, "action_results", None)
        or flow_state.get("current_node_id")
        or flow_state.get("path")
    )


def deadline_matches(execution: Any, latest_message: dict | None) -> bool:
    """El vencimiento sigue en pie si el último mensaje del chat es el mismo
    del vendedor que lo programó."""
    payload = execution.event_payload or {}
    expected_id = str(payload.get("last_message_id") or "")
    if not expected_id or not execution.lead_id:
        return False
    if latest_message is None or latest_message["sender"] != "vendedor":
        return False
    current_id = str(latest_message["wa_message_id"] or latest_message["id"])
    return current_id == expected_id

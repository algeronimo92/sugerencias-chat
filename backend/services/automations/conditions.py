from datetime import timedelta

from sqlalchemy import select

from db.models import AutomationExecution, AutomationRule
from domain_types import AutomationExecutionStatus, FlowConditionType, FlowHandle
from services.automation_deps import DEFAULT_DEPS, AutomationDeps
from services.automation_rules import (
    business_timezone,
    is_business_hours,
    matches_static_conditions,
)
from services.automations.common import (
    _normalize_reply_text,
)


async def _cooldown_blocked(rule_id: int, chat_id: str, minutes: int, deps: AutomationDeps) -> bool:
    """La ejecución en curso todavía está en running/scheduled, nunca en
    completed, así que no hace falta excluirla para que no se bloquee a sí
    misma."""
    cutoff = deps.now() - timedelta(minutes=minutes)
    async with deps.session() as session:
        recent = await session.scalar(
            select(AutomationExecution.id).where(
                AutomationExecution.rule_id == rule_id,
                AutomationExecution.lead_id == chat_id,
                AutomationExecution.status == AutomationExecutionStatus.COMPLETED,
                AutomationExecution.finished_at >= cutoff,
            ).limit(1)
        )
    return recent is not None


async def _matches_condition_values(
    conditions: dict,
    chat: dict,
    rule_id: int | None = None,
    deps: AutomationDeps = DEFAULT_DEPS,
) -> tuple[bool, str | None]:
    if conditions.get("cooldown_minutes") and rule_id is not None:
        minutes = conditions["cooldown_minutes"]
        if await _cooldown_blocked(rule_id, chat["chat_id"], minutes, deps):
            return False, f"Ya se ejecutó para este lead hace menos de {minutes} minutos"
    matches, reason = matches_static_conditions(conditions, chat)
    if not matches:
        return False, reason
    if conditions.get("require_open_window"):
        window = await deps.get_customer_service_window(chat["chat_id"])
        if not window or not window["is_open"]:
            return False, "La ventana de WhatsApp está cerrada"
    if conditions.get("business_hours_only") and not is_business_hours(deps.now().astimezone(business_timezone())):
        return False, "Fuera del horario laboral (lunes a viernes, 08:00–18:00)"
    return True, None


async def _matches_conditions(
    rule: AutomationRule, chat: dict, deps: AutomationDeps = DEFAULT_DEPS
) -> tuple[bool, str | None]:
    return await _matches_condition_values(rule.conditions or {}, chat, rule.id, deps)


def _execution_message_context(execution: AutomationExecution) -> dict:
    """El mensaje del cliente que trajo la ejecución hasta el nodo actual: el
    que la reanudó de una pausa si lo hubo, y si no el que la disparó.

    `message_type` y `analysis_summary` sólo existen para las reanudaciones —
    el disparador no los guarda— así que toda condición que dependa de ellos
    tiene que tolerar que falten."""
    state = execution.flow_state or {}
    resumed_message = state.get("message_context")
    if isinstance(resumed_message, dict) and "content" in resumed_message:
        return {
            "message_id": resumed_message.get("message_id"),
            "content": resumed_message.get("content"),
            "message_type": resumed_message.get("message_type"),
            "analysis_summary": resumed_message.get("analysis_summary"),
        }
    payload = execution.event_payload or {}
    return {
        "message_id": payload.get("message_id"),
        "content": payload.get("content"),
        # Un flujo invocado recibe el contexto del padre en su event_payload,
        # así que la condición sobre el adjunto también funciona ahí dentro.
        "message_type": payload.get("message_type"),
        "analysis_summary": payload.get("analysis_summary"),
    }


async def _matches_flow_condition(
    data: dict,
    chat: dict,
    deps: AutomationDeps = DEFAULT_DEPS,
    message_context: dict | None = None,
) -> tuple[bool, str]:
    """`message_context` es el mensaje del cliente que trajo la ejecución
    hasta acá (ver `_execution_message_context`): su texto, su tipo y la
    descripción que la IA generó si era un adjunto."""
    condition_type = data.get("condition_type")
    value = data.get("value")
    context = message_context or {}
    message_content = context.get("content")
    if condition_type == FlowConditionType.STAGE_EQUALS:
        matches = chat.get("stage") == value
        return matches, f"Etapa {'coincide' if matches else 'no coincide'} con {value}"
    if condition_type == FlowConditionType.ORIGIN_CONTAINS:
        matches = str(value).lower() in (chat.get("origen") or "").lower()
        return matches, f"Origen {'contiene' if matches else 'no contiene'} {value}"
    if condition_type == FlowConditionType.SERVICE_CONTAINS:
        matches = str(value).lower() in (chat.get("servicio_interes") or "").lower()
        return matches, f"Servicio {'contiene' if matches else 'no contiene'} {value}"
    if condition_type in {
        FlowConditionType.MESSAGE_CONTAINS,
        FlowConditionType.MESSAGE_EQUALS,
        FlowConditionType.MESSAGE_NOT_CONTAINS,
    }:
        if message_content is None or not str(message_content).strip():
            return False, "No hay un mensaje de cliente disponible en el contexto del flujo"
        normalized_message = _normalize_reply_text(str(message_content))
        normalized_value = _normalize_reply_text(str(value))
        if condition_type == FlowConditionType.MESSAGE_EQUALS:
            matches = normalized_message == normalized_value
            operation = "es igual a"
        elif condition_type == FlowConditionType.MESSAGE_NOT_CONTAINS:
            matches = normalized_value not in normalized_message
            operation = "no contiene"
        else:
            matches = normalized_value in normalized_message
            operation = "contiene"
        return matches, f"Mensaje {'cumple' if matches else 'no cumple'}: {operation} {value}"
    if condition_type == FlowConditionType.MEDIA_ANALYSIS_CONTAINS:
        summary = context.get("analysis_summary")
        if not summary or not str(summary).strip():
            # Sin descripción no se puede afirmar nada del adjunto, y un texto
            # tampoco la tiene: la rama Sí exige evidencia, no ausencia de ella.
            return False, "El mensaje no es un adjunto con descripción"
        matches = _normalize_reply_text(str(value)) in _normalize_reply_text(str(summary))
        return matches, f"La descripción del archivo {'contiene' if matches else 'no contiene'}: {value}"
    if condition_type == FlowConditionType.SELLER_EQUALS:
        matches = chat.get("vendedor_id") == value
        return matches, "Vendedor coincide" if matches else "Vendedor no coincide"
    if condition_type == FlowConditionType.TAG_PRESENT:
        matches = value in {tag["id"] for tag in chat.get("tags", [])}
        return matches, "Etiqueta presente" if matches else "Etiqueta ausente"
    if condition_type == FlowConditionType.WHATSAPP_WINDOW_OPEN:
        window = await deps.get_customer_service_window(chat["chat_id"])
        matches = bool(window and window["is_open"])
        return matches, "Ventana de WhatsApp abierta" if matches else "Ventana de WhatsApp cerrada"
    matches = is_business_hours(deps.now().astimezone(business_timezone()))
    return matches, "Dentro del horario laboral" if matches else "Fuera del horario laboral"


async def _matches_flow_condition_node(
    data: dict,
    chat: dict,
    deps: AutomationDeps = DEFAULT_DEPS,
    message_context: dict | None = None,
) -> tuple[bool, str, str]:
    """OR entre grupos y AND dentro de cada grupo.

    Las definiciones publicadas antes de los grupos siguen funcionando como
    un único grupo con una sola condición.
    """
    groups = data.get("condition_groups")
    if not isinstance(groups, list):
        matches, detail = await _matches_flow_condition(data, chat, deps, message_context)
        return matches, (FlowHandle.YES if matches else FlowHandle.NO), detail
    failed_groups: list[str] = []
    for group_position, group in enumerate(groups, start=1):
        details: list[str] = []
        group_matches = True
        for condition in group.get("conditions") or []:
            matches, detail = await _matches_flow_condition(
                condition, chat, deps, message_context,
            )
            details.append(detail)
            if not matches:
                group_matches = False
                break
        if group_matches:
            return True, group["id"], f"Grupo {group_position} cumple: {'; '.join(details)}"
        failed_groups.append(f"Grupo {group_position}: {'; '.join(details)}")
    return False, FlowHandle.NO, f"Ninguno de los grupos cumple. {' | '.join(failed_groups)}"

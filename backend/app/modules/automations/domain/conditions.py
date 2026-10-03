"""Evaluación de los bloques Condición de un flujo visual.

Pura: lo único que viene de afuera es si la ventana de WhatsApp está abierta,
y la aplicación lo consulta solo cuando el bloque lo pregunta.
"""

from __future__ import annotations

from datetime import datetime

from app.modules.automations.domain.types import FlowConditionType, FlowHandle

from app.modules.automations.domain.rules import business_timezone, is_business_hours, normalize_reply_text

_MESSAGE_TEXT_CONDITIONS = {
    FlowConditionType.MESSAGE_CONTAINS,
    FlowConditionType.MESSAGE_EQUALS,
    FlowConditionType.MESSAGE_NOT_CONTAINS,
}


def _conditions_of(data: dict) -> list[dict]:
    groups = data.get("condition_groups")
    if not isinstance(groups, list):
        return [data]
    return [condition for group in groups for condition in (group.get("conditions") or [])]


def needs_service_window(data: dict) -> bool:
    """¿El bloque pregunta por la ventana de WhatsApp?"""
    return any(
        condition.get("condition_type") == FlowConditionType.WHATSAPP_WINDOW_OPEN
        for condition in _conditions_of(data)
    )


def match_flow_condition(
    data: dict,
    chat: dict,
    message_context: dict | None,
    *,
    now: datetime,
    window_open: bool | None = None,
) -> tuple[bool, str]:
    """`message_context` es el mensaje del cliente que trajo la ejecución
    hasta acá (ver `execution_message_context`): su texto, su tipo y la
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
    if condition_type in _MESSAGE_TEXT_CONDITIONS:
        if message_content is None or not str(message_content).strip():
            return False, "No hay un mensaje de cliente disponible en el contexto del flujo"
        normalized_message = normalize_reply_text(str(message_content))
        normalized_value = normalize_reply_text(str(value))
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
        matches = normalize_reply_text(str(value)) in normalize_reply_text(str(summary))
        return matches, f"La descripción del archivo {'contiene' if matches else 'no contiene'}: {value}"
    if condition_type == FlowConditionType.REPLY_ID_EQUALS:
        reply_id = context.get("reply_id")
        if not reply_id:
            return False, "El mensaje no es una respuesta a botones o listas"
        matches = reply_id == value
        return matches, f"La respuesta {'es' if matches else 'no es'} {value}"
    if condition_type == FlowConditionType.MESSAGE_TYPE_EQUALS:
        message_type = context.get("message_type")
        if not message_type:
            return False, "No hay un mensaje de cliente disponible en el contexto del flujo"
        subtype = context.get("message_subtype")
        literal = f"{message_type}/{subtype}" if subtype else message_type
        matches = value in {message_type, literal}
        return matches, f"El mensaje {'es' if matches else 'no es'} de tipo {value}"
    if condition_type == FlowConditionType.SELLER_EQUALS:
        matches = chat.get("vendedor_id") == value
        return matches, "Vendedor coincide" if matches else "Vendedor no coincide"
    if condition_type == FlowConditionType.TAG_PRESENT:
        matches = value in {tag["id"] for tag in chat.get("tags", [])}
        return matches, "Etiqueta presente" if matches else "Etiqueta ausente"
    if condition_type == FlowConditionType.WHATSAPP_WINDOW_OPEN:
        matches = bool(window_open)
        return matches, "Ventana de WhatsApp abierta" if matches else "Ventana de WhatsApp cerrada"
    matches = is_business_hours(now.astimezone(business_timezone()))
    return matches, "Dentro del horario laboral" if matches else "Fuera del horario laboral"


def match_condition_node(
    data: dict,
    chat: dict,
    message_context: dict | None,
    *,
    now: datetime,
    window_open: bool | None = None,
) -> tuple[bool, str, str]:
    """OR entre grupos y AND dentro de cada grupo. Devuelve si cumple, la
    salida por la que sigue y el detalle para el historial.

    Las definiciones publicadas antes de los grupos siguen funcionando como
    un único grupo con una sola condición.
    """
    groups = data.get("condition_groups")
    if not isinstance(groups, list):
        matches, detail = match_flow_condition(data, chat, message_context, now=now, window_open=window_open)
        return matches, (FlowHandle.YES if matches else FlowHandle.NO), detail
    failed_groups: list[str] = []
    for group_position, group in enumerate(groups, start=1):
        details: list[str] = []
        group_matches = True
        for condition in group.get("conditions") or []:
            matches, detail = match_flow_condition(
                condition, chat, message_context, now=now, window_open=window_open,
            )
            details.append(detail)
            if not matches:
                group_matches = False
                break
        if group_matches:
            return True, group["id"], f"Grupo {group_position} cumple: {'; '.join(details)}"
        failed_groups.append(f"Grupo {group_position}: {'; '.join(details)}")
    return False, FlowHandle.NO, f"Ninguno de los grupos cumple. {' | '.join(failed_groups)}"

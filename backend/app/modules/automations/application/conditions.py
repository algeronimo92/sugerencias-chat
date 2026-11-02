"""Condiciones que necesitan mirar afuera del lead: el cooldown de la regla y
la ventana de WhatsApp. El resto lo resuelve el dominio."""

from __future__ import annotations

from datetime import timedelta

from app.modules.automations.application.deps import AutomationDeps
from app.modules.automations.domain.conditions import match_condition_node, needs_service_window
from app.modules.automations.domain.rules import business_timezone, is_business_hours, matches_static_conditions


async def _window_is_open(chat: dict, deps: AutomationDeps) -> bool:
    window = await deps.get_customer_service_window(chat["chat_id"])
    return bool(window and window["is_open"])


async def matches_condition_values(
    conditions: dict,
    chat: dict,
    rule_id: int | None,
    deps: AutomationDeps,
) -> tuple[bool, str | None]:
    """Las condiciones de entrada de una regla. La ejecución en curso todavía
    está en running/scheduled, nunca en completed, así que el cooldown no la
    cuenta contra sí misma."""
    if conditions.get("cooldown_minutes") and rule_id is not None:
        minutes = conditions["cooldown_minutes"]
        cutoff = deps.now() - timedelta(minutes=minutes)
        if await deps.executions.completed_for_lead_since(rule_id, chat["chat_id"], cutoff):
            return False, f"Ya se ejecutó para este lead hace menos de {minutes} minutos"
    matches, reason = matches_static_conditions(conditions, chat)
    if not matches:
        return False, reason
    if conditions.get("require_open_window") and not await _window_is_open(chat, deps):
        return False, "La ventana de WhatsApp está cerrada"
    if conditions.get("business_hours_only") and not is_business_hours(deps.now().astimezone(business_timezone())):
        return False, "Fuera del horario laboral (lunes a viernes, 08:00–18:00)"
    return True, None


async def matches_condition_node(
    data: dict,
    chat: dict,
    deps: AutomationDeps,
    message_context: dict | None = None,
) -> tuple[bool, str, str]:
    window_open = await _window_is_open(chat, deps) if needs_service_window(data) else None
    return match_condition_node(data, chat, message_context, now=deps.now(), window_open=window_open)

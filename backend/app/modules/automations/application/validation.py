"""Validación de reglas y flujos: la forma la da el dominio, y acá se
verifica contra la base lo que mencionan (``ReferenceChecker``)."""

from __future__ import annotations

from app.modules.automations.application.ports import ReferenceChecker, RuleStore, automation_ports
from app.modules.automations.domain.flow_definition import check_invoked_flows, connect_flow, normalize_flow
from app.modules.automations.domain.limits import MAX_ACTIONS
from app.modules.automations.domain.validation import ActionReferences, normalize_rate_limit, normalize_rule


async def verify_references(refs: ActionReferences, references: ReferenceChecker) -> None:
    # Etapas del negocio: el destino de "cambiar etapa" debe estar activo; la
    # condición solo tiene que existir (filtrar por una etapa desactivada que
    # todavía tiene leads es válido).
    for keys, active_only in ((refs.stages, True), (refs.condition_stages, False)):
        if keys:
            problem = await references.stage_problem(keys, active_only=active_only)
            if problem:
                raise ValueError(f"Etapa inválida: {problem}")
    if refs.users and await references.inactive_users(refs.users):
        raise ValueError("Algún usuario seleccionado no existe o está inactivo")
    if refs.tags and await references.inactive_tags(refs.tags):
        raise ValueError("Alguna etiqueta seleccionada no existe o está inactiva")
    if refs.templates and await references.unusable_templates(refs.templates):
        raise ValueError("El envío automático solo admite plantillas internas activas (sin botones/listas)")
    if refs.media_assets and await references.missing_media_assets(refs.media_assets):
        raise ValueError("Algún archivo de la librería de medios ya no existe")


async def validate_automation_rule(
    values: dict, *, max_actions: int = MAX_ACTIONS, references: ReferenceChecker | None = None,
) -> dict:
    normalized, refs = normalize_rule(values, max_actions=max_actions)
    await verify_references(refs, references or automation_ports().references)
    max_per_hour = normalize_rate_limit(values.get("max_executions_per_hour"))
    return {
        "name": normalized["name"],
        "trigger_type": normalized["trigger_type"],
        "trigger_config": normalized["trigger_config"],
        "conditions": normalized["conditions"],
        "actions": normalized["actions"],
        "delay_minutes": normalized["delay_minutes"],
        "max_executions_per_hour": max_per_hour,
        "is_active": normalized["is_active"],
        "visible_to_sellers": normalized["visible_to_sellers"],
    }


async def validate_visual_flow(
    name: str,
    definition: dict,
    *,
    current_rule_id: int | None = None,
    references: ReferenceChecker | None = None,
    rules: RuleStore | None = None,
) -> dict:
    references = references or automation_ports().references
    rules = rules or automation_ports().rules
    flow = normalize_flow(name, definition)
    await verify_references(flow.refs, references)
    if flow.condition_users and await references.inactive_users(flow.condition_users):
        raise ValueError("Algún vendedor usado en una condición no existe o está inactivo")
    if flow.condition_tags and await references.inactive_tags(flow.condition_tags):
        raise ValueError("Alguna etiqueta usada en una condición no existe o está inactiva")
    if flow.condition_stages:
        problem = await references.stage_problem(flow.condition_stages, active_only=False)
        if problem:
            raise ValueError(f"Etapa usada en una condición: {problem}")
    if flow.invoked_flow_ids:
        check_invoked_flows(
            await rules.flow_targets(), flow.invoked_flow_ids, current_rule_id, {"nodes": flow.nodes},
        )
    return connect_flow(flow)

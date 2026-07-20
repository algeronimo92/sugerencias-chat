from fastapi import APIRouter, Depends, HTTPException, Query

from domain_types import AutomationBuilderMode
from db.models import User
from models.schemas import (
    AutomationExecutionItem,
    AutomationFlowCreate,
    AutomationFlowSimulationRequest,
    AutomationFlowUpdate,
    AutomationFlowVersionItem,
    AutomationRuleCreate,
    AutomationRuleItem,
    AutomationRuleUpdate,
)
from services.auth_service import require_admin
from services.automation_service import (
    cancel_automation_execution,
    create_visual_flow,
    create_automation_rule,
    duplicate_automation_rule,
    get_automation_rule,
    list_automation_executions,
    list_automation_rules,
    list_flow_versions,
    publish_visual_flow,
    restore_flow_version,
    retry_automation_execution,
    save_visual_flow,
    simulate_visual_flow,
    update_automation_rule,
    validate_automation_rule,
)
from services.ws_manager import manager

router = APIRouter(prefix="/api/automations", tags=["automations"])


@router.get("", response_model=list[AutomationRuleItem])
async def get_rules(_admin: User = Depends(require_admin)):
    return await list_automation_rules()


@router.post("", response_model=AutomationRuleItem, status_code=201)
async def post_rule(body: AutomationRuleCreate, admin: User = Depends(require_admin)):
    try:
        values = await validate_automation_rule(body.model_dump())
    except (ValueError, TypeError) as exc:
        raise HTTPException(400, str(exc))
    item = await create_automation_rule(values, admin.id)
    await manager.broadcast({"type": "automations_updated"})
    return item


@router.post("/{rule_id}/duplicate", response_model=AutomationRuleItem, status_code=201)
async def post_duplicate(rule_id: int, admin: User = Depends(require_admin)):
    item = await duplicate_automation_rule(rule_id, admin.id)
    if item is None:
        raise HTTPException(404, "Automatización no encontrada")
    return item


@router.post("/flows", response_model=AutomationRuleItem, status_code=201)
async def post_flow(body: AutomationFlowCreate, admin: User = Depends(require_admin)):
    try:
        item = await create_visual_flow(body.name, body.flow_definition, admin.id)
    except (ValueError, TypeError) as exc:
        raise HTTPException(400, str(exc))
    await manager.broadcast({"type": "automations_updated"})
    return item


@router.patch("/{rule_id}/flow", response_model=AutomationRuleItem)
async def patch_flow(
    rule_id: int,
    body: AutomationFlowUpdate,
    _admin: User = Depends(require_admin),
):
    current = await get_automation_rule(rule_id)
    if current is None or current["builder_mode"] != AutomationBuilderMode.VISUAL:
        raise HTTPException(404, "Flujo visual no encontrado")
    try:
        item = await save_visual_flow(
            rule_id, body.name if body.name is not None else current["name"], body.flow_definition
        )
    except (ValueError, TypeError) as exc:
        raise HTTPException(400, str(exc))
    await manager.broadcast({"type": "automations_updated"})
    return item


@router.post("/{rule_id}/publish", response_model=AutomationRuleItem)
async def publish_flow(rule_id: int, _admin: User = Depends(require_admin)):
    try:
        item = await publish_visual_flow(rule_id)
    except (ValueError, TypeError) as exc:
        raise HTTPException(400, str(exc))
    if item is None:
        raise HTTPException(404, "Flujo visual no encontrado")
    await manager.broadcast({"type": "automations_updated"})
    return item


@router.get("/{rule_id}/versions", response_model=list[AutomationFlowVersionItem])
async def get_flow_versions(rule_id: int, _admin: User = Depends(require_admin)):
    current = await get_automation_rule(rule_id)
    if current is None or current["builder_mode"] != AutomationBuilderMode.VISUAL:
        raise HTTPException(404, "Flujo visual no encontrado")
    return await list_flow_versions(rule_id)


@router.post("/{rule_id}/versions/{version}/restore", response_model=AutomationRuleItem)
async def post_restore_flow_version(
    rule_id: int,
    version: int,
    _admin: User = Depends(require_admin),
):
    try:
        item = await restore_flow_version(rule_id, version)
    except (ValueError, TypeError) as exc:
        raise HTTPException(400, str(exc))
    if item is None:
        raise HTTPException(404, "Versión no encontrada")
    await manager.broadcast({"type": "automations_updated"})
    return item


@router.post("/{rule_id}/simulate")
async def simulate_flow(
    rule_id: int,
    body: AutomationFlowSimulationRequest,
    _admin: User = Depends(require_admin),
):
    try:
        return await simulate_visual_flow(rule_id, body.lead_id)
    except (ValueError, TypeError) as exc:
        raise HTTPException(400, str(exc))


@router.patch("/{rule_id}", response_model=AutomationRuleItem)
async def patch_rule(
    rule_id: int,
    body: AutomationRuleUpdate,
    _admin: User = Depends(require_admin),
):
    current = await get_automation_rule(rule_id)
    if current is None:
        raise HTTPException(404, "Automatización no encontrada")
    requested = body.model_dump(exclude_unset=True)
    if current["builder_mode"] == AutomationBuilderMode.VISUAL:
        # Una regla visual no tiene actions/conditions propias: mandarla por
        # validate_automation_rule fallaría con un error confuso.
        if not set(requested) <= {"is_active", "name", "max_executions_per_hour"}:
            raise HTTPException(400, "Los flujos visuales se editan desde el constructor de flujos")
        values: dict = {}
        if "name" in requested:
            name = str(requested["name"] or "").strip()
            if not name or len(name) > 120:
                raise HTTPException(400, "El nombre debe tener entre 1 y 120 caracteres")
            values["name"] = name
        if "max_executions_per_hour" in requested:
            values["max_executions_per_hour"] = requested["max_executions_per_hour"]
        if "is_active" in requested:
            if requested["is_active"] and not current["published_flow_definition"]:
                raise HTTPException(400, "Publica el flujo antes de activarlo")
            values["is_active"] = requested["is_active"]
        if not values:
            raise HTTPException(400, "Nada que actualizar")
        item = await update_automation_rule(rule_id, values)
    elif set(requested) == {"is_active"} and requested["is_active"] is False:
        item = await update_automation_rule(rule_id, requested)
    else:
        merged = {
            key: requested.get(key, current[key])
            for key in (
                "name", "trigger_type", "trigger_config", "conditions",
                "actions", "delay_minutes", "max_executions_per_hour", "is_active",
            )
        }
        try:
            normalized = await validate_automation_rule(merged)
        except (ValueError, TypeError) as exc:
            raise HTTPException(400, str(exc))
        item = await update_automation_rule(rule_id, normalized)
    if item is None:
        raise HTTPException(404, "Automatización no encontrada")
    await manager.broadcast({"type": "automations_updated"})
    return item


@router.get("/executions", response_model=list[AutomationExecutionItem])
async def get_executions(
    rule_id: int | None = None,
    status: str | None = Query(default=None, pattern="^(scheduled|running|completed|failed|skipped)$"),
    limit: int = Query(default=100, ge=1, le=500),
    _admin: User = Depends(require_admin),
):
    return await list_automation_executions(rule_id, status, limit)


@router.post("/executions/{execution_id}/retry", response_model=AutomationExecutionItem)
async def post_retry_execution(execution_id: int, _admin: User = Depends(require_admin)):
    item = await retry_automation_execution(execution_id)
    if item is None:
        raise HTTPException(409, "Solo se pueden reintentar ejecuciones con error u omitidas")
    return item


@router.post("/executions/{execution_id}/cancel", response_model=AutomationExecutionItem)
async def post_cancel_execution(execution_id: int, _admin: User = Depends(require_admin)):
    item = await cancel_automation_execution(execution_id)
    if item is None:
        raise HTTPException(409, "Solo se pueden cancelar ejecuciones programadas o en curso")
    return item

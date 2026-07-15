from fastapi import APIRouter, Depends, HTTPException, Query

from db.models import User
from models.schemas import (
    AutomationExecutionItem,
    AutomationFlowCreate,
    AutomationFlowSimulationRequest,
    AutomationFlowUpdate,
    AutomationRuleCreate,
    AutomationRuleItem,
    AutomationRuleUpdate,
)
from services.auth_service import require_admin
from services.automation_service import (
    create_visual_flow,
    create_automation_rule,
    get_automation_rule,
    list_automation_executions,
    list_automation_rules,
    publish_visual_flow,
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
    if current is None or current["builder_mode"] != "visual":
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
    if set(requested) == {"is_active"} and (
        requested["is_active"] is False
        or (current["builder_mode"] == "visual" and current["published_flow_definition"])
    ):
        item = await update_automation_rule(rule_id, requested)
    else:
        merged = {
            key: requested.get(key, current[key])
            for key in (
                "name", "trigger_type", "trigger_config", "conditions",
                "actions", "delay_minutes", "is_active",
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

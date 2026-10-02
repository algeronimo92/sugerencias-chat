from fastapi import APIRouter, Depends, HTTPException, Response

from app.db.models.auth import User
from app.modules.leads.schemas import LeadStageKey, LeadStageAdminItem, LeadStageCreate, LeadStageItem, LeadStageOrder, LeadStagePatch
from app.modules.auth.public import get_current_user, require_admin
from app.modules.leads.stages import (
    LeadStageConflictError,
    LeadStageInUseError,
    LeadStageNotFoundError,
    LeadStageProtectedError,
    create_lead_stage,
    delete_lead_stage,
    list_lead_stages,
    reorder_lead_stages,
    update_lead_stage_definition,
)
from app.realtime.ws_manager import manager

router = APIRouter(prefix="/api/lead-stages", tags=["lead-stages"])


def _clean_description(value: str | None) -> str | None:
    # Vacío equivale a borrar el criterio, igual que en los textos del
    # catálogo de servicios.
    return " ".join((value or "").split()) or None


async def _broadcast_stages_changed() -> None:
    # Kanban, filtros y fichas abiertas rotulan con estas etapas: sin el
    # aviso, un renombre no se vería hasta el siguiente refresco.
    await manager.broadcast({"type": "lead_stages_updated"})


def _raise_http(exc: Exception) -> None:
    if isinstance(exc, LeadStageNotFoundError):
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if isinstance(exc, LeadStageProtectedError):
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("", response_model=list[LeadStageItem])
async def get_lead_stages(_user: User = Depends(get_current_user)):
    """Etapas del negocio en orden del embudo, incluidas las inactivas: los
    leads que siguen en una etapa desactivada tienen que poder rotularse."""
    return await list_lead_stages()


@router.get("/all", response_model=list[LeadStageAdminItem])
async def get_lead_stages_admin(_admin: User = Depends(require_admin)):
    return await list_lead_stages(include_usage=True)


@router.post("", response_model=LeadStageItem, status_code=201)
async def post_lead_stage(body: LeadStageCreate, _admin: User = Depends(require_admin)):
    values = body.model_dump()
    values["name"] = " ".join(values["name"].split())
    values["description"] = _clean_description(values.get("description"))
    try:
        stage = await create_lead_stage(values)
    except LeadStageConflictError as exc:
        _raise_http(exc)
    await _broadcast_stages_changed()
    return stage


@router.put("/order", response_model=list[LeadStageAdminItem])
async def put_lead_stage_order(body: LeadStageOrder, _admin: User = Depends(require_admin)):
    try:
        stages = await reorder_lead_stages(body.keys)
    except LeadStageConflictError as exc:
        _raise_http(exc)
    await _broadcast_stages_changed()
    return stages


@router.patch("/{key}", response_model=LeadStageItem)
async def patch_lead_stage(key: LeadStageKey, body: LeadStagePatch, _admin: User = Depends(require_admin)):
    values = body.model_dump(exclude_unset=True)
    for field in ("name", "color", "kind", "is_active"):
        if field in values and values[field] is None:
            raise HTTPException(status_code=400, detail=f"{field} no puede ser null")
    if "name" in values:
        values["name"] = " ".join(values["name"].split())
    if "description" in values:
        values["description"] = _clean_description(values["description"])
    try:
        stage = await update_lead_stage_definition(key, values)
    except (LeadStageNotFoundError, LeadStageProtectedError, LeadStageConflictError) as exc:
        _raise_http(exc)
    await _broadcast_stages_changed()
    return stage


@router.delete("/{key}", status_code=204)
async def remove_lead_stage(key: LeadStageKey, _admin: User = Depends(require_admin)):
    try:
        await delete_lead_stage(key)
    except (LeadStageNotFoundError, LeadStageProtectedError, LeadStageInUseError) as exc:
        _raise_http(exc)
    await _broadcast_stages_changed()
    return Response(status_code=204)

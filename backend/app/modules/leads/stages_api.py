from fastapi import APIRouter, Depends, HTTPException, Response

from app.modules.auth.public import User
from app.modules.leads.schemas import LeadStageKey, LeadStageAdminItem, LeadStageCreate, LeadStageItem, LeadStageOrder, LeadStagePatch
from app.modules.auth.public import get_current_user, require_admin
from app.modules.leads.stage_queries import list_lead_stages
from app.modules.leads.stages import (
    create_lead_stage,
    delete_lead_stage,
    reorder_lead_stages,
    update_lead_stage_definition,
)

router = APIRouter(prefix="/api/lead-stages", tags=["lead-stages"])


def _clean_description(value: str | None) -> str | None:
    # Vacío equivale a borrar el criterio, igual que en los textos del
    # catálogo de servicios.
    return " ".join((value or "").split()) or None


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
    return await create_lead_stage(values)


@router.put("/order", response_model=list[LeadStageAdminItem])
async def put_lead_stage_order(body: LeadStageOrder, _admin: User = Depends(require_admin)):
    return await reorder_lead_stages(body.keys)


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
    return await update_lead_stage_definition(key, values)


@router.delete("/{key}", status_code=204)
async def remove_lead_stage(key: LeadStageKey, _admin: User = Depends(require_admin)):
    await delete_lead_stage(key)
    return Response(status_code=204)

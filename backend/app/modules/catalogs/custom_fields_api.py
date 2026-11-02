from fastapi import APIRouter, Depends, HTTPException, Query

from app.modules.auth.public import User
from app.modules.catalogs.schemas import CustomFieldDefinitionCreate, CustomFieldDefinitionItem, CustomFieldDefinitionUpdate, CustomFieldEntity, CustomFieldValues
from app.modules.auth.public import get_current_user, require_admin
from app.modules.catalogs.custom_fields import (
    CustomFieldAlreadyExistsError,
    CustomFieldError,
    create_definition,
    get_lead_values,
    list_definitions,
    update_definition,
    update_lead_values,
)


router = APIRouter(prefix="/api/custom-fields", tags=["custom-fields"])


@router.get("", response_model=list[CustomFieldDefinitionItem])
async def get_definitions(
    entity_type: CustomFieldEntity = Query(...),
    include_inactive: bool = False,
    user: User = Depends(get_current_user),
):
    if include_inactive and user.role != "admin":
        raise HTTPException(403, "Solo un administrador puede ver campos inactivos")
    return await list_definitions(entity_type, include_inactive=include_inactive)


@router.post("", response_model=CustomFieldDefinitionItem, status_code=201)
async def post_definition(body: CustomFieldDefinitionCreate, _admin: User = Depends(require_admin)):
    try:
        return await create_definition(body.model_dump())
    except CustomFieldAlreadyExistsError as exc:
        raise HTTPException(409, str(exc)) from exc
    except CustomFieldError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.patch("/{field_id}", response_model=CustomFieldDefinitionItem)
async def patch_definition(
    field_id: int,
    body: CustomFieldDefinitionUpdate,
    _admin: User = Depends(require_admin),
):
    try:
        result = await update_definition(field_id, body.model_dump(exclude_unset=True))
    except CustomFieldError as exc:
        raise HTTPException(400, str(exc)) from exc
    if result is None:
        raise HTTPException(404, "Campo personalizado no encontrado")
    return result


@router.get("/lead-values/{lead_id}", response_model=CustomFieldValues)
async def get_values(lead_id: str, _user: User = Depends(get_current_user)):
    values = await get_lead_values(lead_id)
    if values is None:
        raise HTTPException(404, "Lead no encontrado")
    return {"values": values}


@router.patch("/lead-values/{lead_id}", response_model=CustomFieldValues)
async def patch_values(lead_id: str, body: CustomFieldValues, _user: User = Depends(get_current_user)):
    try:
        values = await update_lead_values(lead_id, body.values)
    except CustomFieldError as exc:
        raise HTTPException(422, str(exc)) from exc
    if values is None:
        raise HTTPException(404, "Lead no encontrado")
    return {"values": values}

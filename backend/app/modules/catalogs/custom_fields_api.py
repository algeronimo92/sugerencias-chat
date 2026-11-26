from fastapi import APIRouter, Depends, HTTPException, Query

from app.modules.auth.public import User
from app.modules.catalogs.schemas import CustomFieldDefinitionCreate, CustomFieldDefinitionItem, CustomFieldDefinitionUpdate, CustomFieldEntity, CustomFieldValues
from app.modules.auth.public import Permission, can, require_permission
from app.modules.leads.ports.visibility import require_visible_lead
from app.modules.platform.ports.plan import Feature, require_feature
from app.modules.catalogs.custom_fields import (
    CustomFieldAlreadyExistsError,
    CustomFieldError,
    create_definition,
    get_lead_values,
    list_definitions,
    update_definition,
    update_lead_values,
)


require_catalogs_manage = require_permission(Permission.CATALOGS_MANAGE)
require_leads_view = require_permission(Permission.LEADS_VIEW)
# Los formularios de lead y de cita piden las definiciones de su entidad.
require_definitions_view = require_permission(
    Permission.LEADS_VIEW, Permission.APPOINTMENTS_VIEW, Permission.CATALOGS_MANAGE,
)
require_leads_edit = require_permission(Permission.LEADS_EDIT)
require_custom_fields = Depends(require_feature(Feature.CUSTOM_FIELDS))

router = APIRouter(prefix="/api/custom-fields", tags=["custom-fields"], dependencies=[Depends(require_visible_lead)])


@router.get("", response_model=list[CustomFieldDefinitionItem])
async def get_definitions(
    entity_type: CustomFieldEntity = Query(...),
    include_inactive: bool = False,
    user: User = Depends(require_definitions_view),
):
    if include_inactive and not can(user, Permission.CATALOGS_MANAGE):
        raise HTTPException(403, "Tu rol no puede ver campos inactivos")
    return await list_definitions(entity_type, include_inactive=include_inactive)


# Crear o editar campos depende del paquete; los valores ya cargados se
# siguen viendo y editando aunque el negocio baje de paquete.
@router.post("", response_model=CustomFieldDefinitionItem, status_code=201, dependencies=[require_custom_fields])
async def post_definition(body: CustomFieldDefinitionCreate, _admin: User = Depends(require_catalogs_manage)):
    try:
        return await create_definition(body.model_dump())
    except CustomFieldAlreadyExistsError as exc:
        raise HTTPException(409, str(exc)) from exc
    except CustomFieldError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.patch("/{field_id}", response_model=CustomFieldDefinitionItem, dependencies=[require_custom_fields])
async def patch_definition(
    field_id: int,
    body: CustomFieldDefinitionUpdate,
    _admin: User = Depends(require_catalogs_manage),
):
    try:
        result = await update_definition(field_id, body.model_dump(exclude_unset=True))
    except CustomFieldError as exc:
        raise HTTPException(400, str(exc)) from exc
    if result is None:
        raise HTTPException(404, "Campo personalizado no encontrado")
    return result


@router.get("/lead-values/{lead_id}", response_model=CustomFieldValues)
async def get_values(lead_id: str, _user: User = Depends(require_leads_view)):
    values = await get_lead_values(lead_id)
    if values is None:
        raise HTTPException(404, "Lead no encontrado")
    return {"values": values}


@router.patch("/lead-values/{lead_id}", response_model=CustomFieldValues)
async def patch_values(lead_id: str, body: CustomFieldValues, _user: User = Depends(require_leads_edit)):
    try:
        values = await update_lead_values(lead_id, body.values)
    except CustomFieldError as exc:
        raise HTTPException(422, str(exc)) from exc
    if values is None:
        raise HTTPException(404, "Lead no encontrado")
    return {"values": values}

from fastapi import APIRouter, Depends, HTTPException

from db.models import User
from models.schemas import LeadServiceCreate, LeadServiceItem, LeadServiceUpdate
from services.auth_service import get_current_user, require_admin
from services.db_service import (
    LeadServiceAlreadyExistsError,
    create_lead_service,
    list_lead_services,
    update_lead_service,
)

router = APIRouter(prefix="/api/services", tags=["lead-services"])


@router.get("", response_model=list[LeadServiceItem])
async def get_services(_user: User = Depends(get_current_user)):
    return await list_lead_services()


@router.get("/all", response_model=list[LeadServiceItem])
async def get_all_services(_admin: User = Depends(require_admin)):
    return await list_lead_services(include_inactive=True)


@router.post("", response_model=LeadServiceItem, status_code=201)
async def post_service(body: LeadServiceCreate, user: User = Depends(get_current_user)):
    name = " ".join(body.name.split())
    if not name:
        raise HTTPException(status_code=400, detail="El nombre es obligatorio")
    try:
        return await create_lead_service(name, user.id)
    except LeadServiceAlreadyExistsError:
        raise HTTPException(status_code=409, detail="Ya existe un servicio con ese nombre")


@router.patch("/{service_id}", response_model=LeadServiceItem)
async def patch_service(
    service_id: int,
    body: LeadServiceUpdate,
    admin: User = Depends(require_admin),
):
    values = body.model_dump(exclude_unset=True)
    if "name" in values:
        if values["name"] is None:
            raise HTTPException(status_code=400, detail="El nombre no puede ser null")
        values["name"] = " ".join(values["name"].split())
        if not values["name"]:
            raise HTTPException(status_code=400, detail="El nombre es obligatorio")
    try:
        service = await update_lead_service(service_id, values, admin.id)
    except LeadServiceAlreadyExistsError:
        raise HTTPException(status_code=409, detail="Ya existe un servicio con ese nombre")
    if service is None:
        raise HTTPException(status_code=404, detail="Servicio no encontrado")
    return service

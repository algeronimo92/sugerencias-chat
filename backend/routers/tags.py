import re

from fastapi import APIRouter, Depends, HTTPException

from db.models import User
from models.schemas import Tag, TagCreate, TagUpdate
from services.auth_service import get_current_user, require_admin
from services.db_service import TagAlreadyExistsError, create_tag, list_tags, update_tag

router = APIRouter(prefix="/api/tags", tags=["tags"])
HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")


@router.get("", response_model=list[Tag])
async def get_tags(_user: User = Depends(get_current_user)):
    return await list_tags()


@router.post("", response_model=Tag, status_code=201)
async def post_tag(body: TagCreate, admin: User = Depends(require_admin)):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="El nombre es obligatorio")
    if not HEX_COLOR.fullmatch(body.color):
        raise HTTPException(status_code=400, detail="Color hexadecimal inválido")
    try:
        return await create_tag(name, body.color.lower(), admin.id)
    except TagAlreadyExistsError:
        raise HTTPException(status_code=409, detail="Ya existe una etiqueta con ese nombre")


@router.patch("/{tag_id}", response_model=Tag)
async def patch_tag(tag_id: int, body: TagUpdate, _admin: User = Depends(require_admin)):
    values = body.model_dump(exclude_unset=True)
    if "name" in values:
        if values["name"] is None:
            raise HTTPException(status_code=400, detail="El nombre no puede ser null")
        values["name"] = values["name"].strip()
        if not values["name"]:
            raise HTTPException(status_code=400, detail="El nombre es obligatorio")
    if "color" in values:
        if values["color"] is None:
            raise HTTPException(status_code=400, detail="El color no puede ser null")
        if not HEX_COLOR.fullmatch(values["color"]):
            raise HTTPException(status_code=400, detail="Color hexadecimal inválido")
        values["color"] = values["color"].lower()
    try:
        tag = await update_tag(tag_id, values)
    except TagAlreadyExistsError:
        raise HTTPException(status_code=409, detail="Ya existe una etiqueta con ese nombre")
    if tag is None:
        raise HTTPException(status_code=404, detail="Etiqueta no encontrada")
    return tag

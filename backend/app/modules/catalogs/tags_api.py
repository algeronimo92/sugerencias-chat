import re

from fastapi import APIRouter, Depends, HTTPException

from app.modules.auth.public import User
from app.modules.catalogs.schemas import Tag, TagCreate, TagUpdate
from app.modules.auth.public import Permission, require_permission
from app.modules.catalogs.queries import list_tags
from app.modules.catalogs.service import TagAlreadyExistsError, create_tag, update_tag

require_catalogs_manage = require_permission(Permission.CATALOGS_MANAGE)
# El chat y la ficha del lead los listan para elegir.
require_leads_view = require_permission(Permission.LEADS_VIEW)

router = APIRouter(prefix="/api/tags", tags=["tags"])
HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")


@router.get("", response_model=list[Tag])
async def get_tags(_user: User = Depends(require_leads_view)):
    return await list_tags()


@router.get("/all", response_model=list[Tag])
async def get_all_tags(_admin: User = Depends(require_catalogs_manage)):
    """Catálogo completo para administración, incluidas las desactivadas."""
    return await list_tags(include_inactive=True)


@router.post("", response_model=Tag, status_code=201)
async def post_tag(body: TagCreate, admin: User = Depends(require_catalogs_manage)):
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
async def patch_tag(tag_id: int, body: TagUpdate, _admin: User = Depends(require_catalogs_manage)):
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

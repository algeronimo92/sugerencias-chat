from fastapi import APIRouter, Depends, HTTPException

from db.models import User
from models.schemas import (
    TemplateCategoryCreate,
    TemplateCategoryItem,
    TemplateCategoryUpdate,
)
from services.auth_service import get_current_user, require_admin
from services.template_category_service import (
    TemplateCategoryAlreadyExistsError,
    create_template_category,
    list_template_categories,
    update_template_category,
)

router = APIRouter(prefix="/api/template-categories", tags=["template-categories"])


def _name(value: str) -> str:
    name = " ".join(value.split())
    if not name:
        raise HTTPException(400, "El nombre es obligatorio")
    return name


@router.get("", response_model=list[TemplateCategoryItem])
async def get_categories(_user: User = Depends(get_current_user)):
    return await list_template_categories()


@router.get("/all", response_model=list[TemplateCategoryItem])
async def get_all_categories(_admin: User = Depends(require_admin)):
    return await list_template_categories(include_inactive=True)


@router.post("", response_model=TemplateCategoryItem, status_code=201)
async def post_category(body: TemplateCategoryCreate, admin: User = Depends(require_admin)):
    try:
        return await create_template_category(_name(body.name), admin.id)
    except TemplateCategoryAlreadyExistsError:
        raise HTTPException(409, "Ya existe una categoría con ese nombre")


@router.patch("/{category_id}", response_model=TemplateCategoryItem)
async def patch_category(
    category_id: int,
    body: TemplateCategoryUpdate,
    _admin: User = Depends(require_admin),
):
    values = body.model_dump(exclude_unset=True)
    if "name" in values:
        if values["name"] is None:
            raise HTTPException(400, "El nombre no puede ser null")
        values["name"] = _name(values["name"])
    if values.get("is_active", True) is None:
        raise HTTPException(400, "El estado no puede ser null")
    try:
        category = await update_template_category(category_id, values)
    except TemplateCategoryAlreadyExistsError:
        raise HTTPException(409, "Ya existe una categoría con ese nombre")
    if category is None:
        raise HTTPException(404, "Categoría no encontrada")
    return category

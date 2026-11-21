from fastapi import APIRouter, Depends, HTTPException

from app.modules.auth.public import User
from app.modules.catalogs.schemas import TemplateCategoryCreate, TemplateCategoryItem, TemplateCategoryUpdate
from app.modules.auth.public import Permission, require_permission
from app.modules.catalogs.template_categories_queries import list_template_categories
from app.modules.catalogs.template_categories_service import TemplateCategoryAlreadyExistsError, create_template_category, update_template_category

require_templates_manage = require_permission(Permission.TEMPLATES_MANAGE)
require_templates_use = require_permission(Permission.TEMPLATES_USE)

router = APIRouter(prefix="/api/template-categories", tags=["template-categories"])


def _name(value: str) -> str:
    name = " ".join(value.split())
    if not name:
        raise HTTPException(400, "El nombre es obligatorio")
    return name


@router.get("", response_model=list[TemplateCategoryItem])
async def get_categories(_user: User = Depends(require_templates_use)):
    return await list_template_categories()


@router.get("/all", response_model=list[TemplateCategoryItem])
async def get_all_categories(_admin: User = Depends(require_templates_manage)):
    return await list_template_categories(include_inactive=True)


@router.post("", response_model=TemplateCategoryItem, status_code=201)
async def post_category(body: TemplateCategoryCreate, admin: User = Depends(require_templates_manage)):
    try:
        return await create_template_category(_name(body.name), admin.id)
    except TemplateCategoryAlreadyExistsError:
        raise HTTPException(409, "Ya existe una categoría con ese nombre")


@router.patch("/{category_id}", response_model=TemplateCategoryItem)
async def patch_category(
    category_id: int,
    body: TemplateCategoryUpdate,
    _admin: User = Depends(require_templates_manage),
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

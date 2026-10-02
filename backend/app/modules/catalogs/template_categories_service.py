"""Named domain use cases; atomic persistence belongs to the repository."""
from __future__ import annotations

from app.modules.catalogs import template_categories_repository
from app.modules.catalogs.template_categories_repository import TemplateCategoryAlreadyExistsError

async def create_template_category(name: str, user_id: int) -> dict:
    return await template_categories_repository.create_template_category(name, user_id)

async def get_template_category_by_name(name: str, active_only: bool=True) -> dict | None:
    return await template_categories_repository.get_template_category_by_name(name, active_only)

async def list_template_categories(include_inactive: bool=False) -> list[dict]:
    return await template_categories_repository.list_template_categories(include_inactive)

async def update_template_category(category_id: int, values: dict) -> dict | None:
    return await template_categories_repository.update_template_category(category_id, values)

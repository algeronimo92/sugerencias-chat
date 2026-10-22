"""Comandos de las categorías de plantillas. Las lecturas viven en
template_categories_queries.py."""

from __future__ import annotations

from app.db.uow import unit_of_work
from app.modules.catalogs import template_categories_repository
from app.modules.catalogs.template_categories_repository import TemplateCategoryAlreadyExistsError

__all__ = ["TemplateCategoryAlreadyExistsError", "create_template_category", "update_template_category"]


async def create_template_category(name: str, user_id: int) -> dict:
    async with unit_of_work():
        return await template_categories_repository.create_template_category(name, user_id)


async def update_template_category(category_id: int, values: dict) -> dict | None:
    async with unit_of_work():
        return await template_categories_repository.update_template_category(category_id, values)

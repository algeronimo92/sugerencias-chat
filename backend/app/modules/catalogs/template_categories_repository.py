from datetime import datetime, timezone

from sqlalchemy import insert
from sqlalchemy.exc import IntegrityError

from app.db.models.catalogs import TemplateCategory
from app.db.uow import session_scope
from app.modules.catalogs.template_categories_queries import list_template_categories


class TemplateCategoryAlreadyExistsError(Exception):
    pass


async def create_template_category(name: str, user_id: int) -> dict:
    now = datetime.now(timezone.utc)
    async with session_scope() as session:
        try:
            category_id = (
                await session.execute(
                    insert(TemplateCategory)
                    .values(name=name, is_active=True, created_by=user_id, created_at=now)
                    .returning(TemplateCategory.id)
                )
            ).scalar_one()
            await session.flush()
        except IntegrityError:
            raise TemplateCategoryAlreadyExistsError(name)
    return next(
        item for item in await list_template_categories(include_inactive=True)
        if item["id"] == category_id
    )


async def update_template_category(category_id: int, values: dict) -> dict | None:
    async with session_scope() as session:
        category = await session.get(TemplateCategory, category_id, with_for_update=True)
        if category is None:
            return None
        try:
            for key, value in values.items():
                setattr(category, key, value)
            await session.flush()
        except IntegrityError:
            raise TemplateCategoryAlreadyExistsError(values.get("name", ""))
    return next(
        item for item in await list_template_categories(include_inactive=True)
        if item["id"] == category_id
    )

from datetime import datetime, timezone

from sqlalchemy import func, insert, select, true, update
from sqlalchemy.exc import IntegrityError

from db.models import MessageTemplate, TemplateCategory, User
from db.session import get_sessionmaker


class TemplateCategoryAlreadyExistsError(Exception):
    pass


def _ts(value: datetime | None) -> str | None:
    return value.isoformat().replace("+00:00", "Z") if value else None


def _item(row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "is_active": row["is_active"],
        "created_by_user_id": row["created_by_user_id"],
        "created_by_name": row["created_by_name"],
        "created_at": _ts(row["created_at"]),
    }


def _query():
    return select(
        TemplateCategory.id,
        TemplateCategory.name,
        TemplateCategory.is_active,
        TemplateCategory.created_by.label("created_by_user_id"),
        User.name.label("created_by_name"),
        TemplateCategory.created_at,
    ).outerjoin(User, User.id == TemplateCategory.created_by)


async def list_template_categories(include_inactive: bool = False) -> list[dict]:
    stmt = _query().order_by(func.lower(TemplateCategory.name).asc())
    if not include_inactive:
        stmt = stmt.where(TemplateCategory.is_active == true())
    async with get_sessionmaker()() as session:
        rows = (await session.execute(stmt)).mappings().all()
    return [_item(row) for row in rows]


async def get_template_category_by_name(name: str, active_only: bool = True) -> dict | None:
    stmt = _query().where(func.lower(TemplateCategory.name) == name.casefold())
    if active_only:
        stmt = stmt.where(TemplateCategory.is_active == true())
    async with get_sessionmaker()() as session:
        row = (await session.execute(stmt)).mappings().first()
    return _item(row) if row else None


async def create_template_category(name: str, user_id: int) -> dict:
    now = datetime.now(timezone.utc)
    async with get_sessionmaker()() as session:
        try:
            category_id = (
                await session.execute(
                    insert(TemplateCategory)
                    .values(name=name, is_active=True, created_by=user_id, created_at=now)
                    .returning(TemplateCategory.id)
                )
            ).scalar_one()
            await session.commit()
        except IntegrityError:
            await session.rollback()
            raise TemplateCategoryAlreadyExistsError(name)
    return next(
        item for item in await list_template_categories(include_inactive=True)
        if item["id"] == category_id
    )


async def update_template_category(category_id: int, values: dict) -> dict | None:
    async with get_sessionmaker()() as session:
        category = await session.get(TemplateCategory, category_id, with_for_update=True)
        if category is None:
            return None
        old_name = category.name
        try:
            if "name" in values and values["name"] != old_name:
                await session.execute(
                    update(MessageTemplate)
                    .where(func.lower(func.btrim(MessageTemplate.category)) == old_name.casefold())
                    .values(category=values["name"], updated_at=datetime.now(timezone.utc))
                )
            for key, value in values.items():
                setattr(category, key, value)
            await session.commit()
        except IntegrityError:
            await session.rollback()
            raise TemplateCategoryAlreadyExistsError(values.get("name", ""))
    return next(
        item for item in await list_template_categories(include_inactive=True)
        if item["id"] == category_id
    )

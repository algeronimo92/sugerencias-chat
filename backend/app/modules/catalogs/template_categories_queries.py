"""Lado de lectura de las categorías de plantillas."""

from sqlalchemy import func, select, true
from app.db.models.catalogs import TemplateCategory
from app.db.models.auth import User
from app.core.time_format import iso_utc
from app.db.uow import session_scope


def _item(row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "is_active": row["is_active"],
        "created_by_user_id": row["created_by_user_id"],
        "created_by_name": row["created_by_name"],
        "created_at": iso_utc(row["created_at"]),
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
    async with session_scope() as session:
        rows = (await session.execute(stmt)).mappings().all()
    return [_item(row) for row in rows]


async def get_template_category_by_name(name: str, active_only: bool = True) -> dict | None:
    stmt = _query().where(func.lower(TemplateCategory.name) == name.casefold())
    if active_only:
        stmt = stmt.where(TemplateCategory.is_active == true())
    async with session_scope() as session:
        row = (await session.execute(stmt)).mappings().first()
    return _item(row) if row else None

from datetime import datetime, timezone

from sqlalchemy import func, insert, select, true, update
from sqlalchemy.exc import IntegrityError

from app.db.models.catalogs import LeadService, LeadTag
from app.db.models.auth import User
from app.db.uow import collect, current_session, session_scope, unit_of_work
from app.modules.catalogs.events import ServiceRenamed
from app.db.store_common import (
    LeadServiceAlreadyExistsError,
    TagAlreadyExistsError,
    _fmt_ts,
)


async def list_tags(include_inactive: bool = False) -> list[dict]:
    stmt = select(
        LeadTag.id,
        LeadTag.name,
        LeadTag.color,
        LeadTag.is_active,
        LeadTag.created_by.label("created_by_user_id"),
        User.name.label("created_by_name"),
        LeadTag.created_at,
    ).outerjoin(User, User.id == LeadTag.created_by).order_by(LeadTag.name.asc())
    if not include_inactive:
        stmt = stmt.where(LeadTag.is_active == true())
    async with session_scope() as session:
        rows = (await session.execute(stmt)).mappings().all()
    return [{**dict(row), "created_at": _fmt_ts(row["created_at"])} for row in rows]


# Lo que el asistente IA usa para cotizar; el resto del CRM solo mira el nombre.
_SERVICE_AI_COLUMNS = (LeadService.description, LeadService.price, LeadService.price_notes)


async def list_lead_services(include_inactive: bool = False) -> list[dict]:
    stmt = select(
        LeadService.id,
        LeadService.name,
        LeadService.is_active,
        *_SERVICE_AI_COLUMNS,
        LeadService.created_by.label("created_by_user_id"),
        User.name.label("created_by_name"),
        LeadService.created_at,
    ).outerjoin(User, User.id == LeadService.created_by).order_by(
        func.lower(LeadService.name).asc()
    )
    if not include_inactive:
        stmt = stmt.where(LeadService.is_active == true())
    async with session_scope() as session:
        rows = (await session.execute(stmt)).mappings().all()
    return [{**dict(row), "created_at": _fmt_ts(row["created_at"])} for row in rows]


async def get_lead_service_by_name(name: str, active_only: bool = True) -> dict | None:
    stmt = select(
        LeadService.id,
        LeadService.name,
        LeadService.is_active,
    ).where(func.lower(LeadService.name) == name.strip().casefold())
    if active_only:
        stmt = stmt.where(LeadService.is_active == true())
    async with session_scope() as session:
        row = (await session.execute(stmt)).mappings().first()
    return dict(row) if row else None


async def create_lead_service(name: str, user_id: int) -> dict:
    now = datetime.now(timezone.utc)
    stmt = (
        insert(LeadService)
        .values(
            name=name,
            is_active=True,
            created_by=user_id,
            created_at=now,
        )
        .returning(
            LeadService.id,
            LeadService.name,
            LeadService.is_active,
            *_SERVICE_AI_COLUMNS,
            LeadService.created_by.label("created_by_user_id"),
            LeadService.created_at,
        )
    )
    async with session_scope() as session:
        try:
            async with session.begin_nested():
                row = (await session.execute(stmt)).mappings().one()
        except IntegrityError:
            raise LeadServiceAlreadyExistsError(name)
        creator_name = await session.scalar(select(User.name).where(User.id == user_id))
    return {
        **dict(row),
        "created_by_name": creator_name,
        "created_at": _fmt_ts(row["created_at"]),
    }


async def update_lead_service(
    service_id: int,
    values: dict,
    actor_user_id: int | None = None,
) -> dict | None:
    """Actualiza un servicio. Renombrarlo publica ``ServiceRenamed``: leads y
    automatizaciones actualizan sus referencias en la misma transacción."""
    async with unit_of_work():
        session = current_session()
        current = (
            await session.execute(
                select(
                    LeadService.id,
                    LeadService.name,
                    LeadService.is_active,
                    *_SERVICE_AI_COLUMNS,
                    LeadService.created_by.label("created_by_user_id"),
                    User.name.label("created_by_name"),
                    LeadService.created_at,
                ).outerjoin(User, User.id == LeadService.created_by).where(LeadService.id == service_id)
            )
        ).mappings().first()
        if current is None:
            return None
        if not values:
            return {**dict(current), "created_at": _fmt_ts(current["created_at"])}

        try:
            async with session.begin_nested():
                row = (
                    await session.execute(
                        update(LeadService)
                        .where(LeadService.id == service_id)
                        .values(**values)
                        .returning(
                            LeadService.id,
                            LeadService.name,
                            LeadService.is_active,
                            *_SERVICE_AI_COLUMNS,
                        )
                    )
                ).mappings().one()
        except IntegrityError:
            raise LeadServiceAlreadyExistsError(values.get("name", ""))

        old_name = current["name"]
        new_name = values.get("name")
        if new_name and new_name != old_name:
            collect(ServiceRenamed(
                service_id=service_id, old_name=old_name, new_name=new_name,
                actor_user_id=actor_user_id,
            ))
    return {
        **dict(row),
        "created_by_user_id": current["created_by_user_id"],
        "created_by_name": current["created_by_name"],
        "created_at": _fmt_ts(current["created_at"]),
    }


async def create_tag(name: str, color: str, user_id: int) -> dict:
    now = datetime.now(timezone.utc)
    stmt = (
        insert(LeadTag)
        .values(
            name=name,
            color=color,
            is_active=True,
            created_by=user_id,
            created_at=now,
        )
        .returning(
            LeadTag.id,
            LeadTag.name,
            LeadTag.color,
            LeadTag.is_active,
            LeadTag.created_by.label("created_by_user_id"),
            LeadTag.created_at,
        )
    )
    async with session_scope() as session:
        try:
            async with session.begin_nested():
                row = (await session.execute(stmt)).mappings().one()
        except IntegrityError:
            raise TagAlreadyExistsError(name)
        creator_name = await session.scalar(select(User.name).where(User.id == user_id))
    return {
        **dict(row),
        "created_by_name": creator_name,
        "created_at": _fmt_ts(row["created_at"]),
    }


async def update_tag(tag_id: int, values: dict) -> dict | None:
    async with session_scope() as session:
        current = (
            await session.execute(
                select(
                    LeadTag.id,
                    LeadTag.name,
                    LeadTag.color,
                    LeadTag.is_active,
                    LeadTag.created_by.label("created_by_user_id"),
                    User.name.label("created_by_name"),
                    LeadTag.created_at,
                ).outerjoin(User, User.id == LeadTag.created_by).where(LeadTag.id == tag_id)
            )
        ).mappings().first()
        if current is None:
            return None
        if not values:
            return {**dict(current), "created_at": _fmt_ts(current["created_at"])}
        try:
            async with session.begin_nested():
                row = (
                    await session.execute(
                        update(LeadTag)
                        .where(LeadTag.id == tag_id)
                        .values(**values)
                        .returning(LeadTag.id, LeadTag.name, LeadTag.color, LeadTag.is_active)
                    )
                ).mappings().first()
        except IntegrityError:
            raise TagAlreadyExistsError(values.get("name", ""))
    return {
        **dict(row),
        "created_by_user_id": current["created_by_user_id"],
        "created_by_name": current["created_by_name"],
        "created_at": _fmt_ts(current["created_at"]),
    } if row else None

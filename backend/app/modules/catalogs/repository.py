from datetime import datetime, timezone

from sqlalchemy import func, insert, select, update
from sqlalchemy.exc import IntegrityError

from app.db.models.catalogs import LeadService, LeadTag, ServicePackage
from app.db.models.auth import User
from app.db.uow import collect, current_session, session_scope, unit_of_work
from app.modules.catalogs.events import ServiceRenamed
from app.core.time_format import iso_utc_micros as _fmt_ts
from app.modules.catalogs.errors import (
    LeadServiceAlreadyExistsError,
    ServicePackageAlreadyExistsError,
    TagAlreadyExistsError,
)
from app.modules.catalogs.queries import PACKAGE_COLUMNS, _SERVICE_AI_COLUMNS, packages_by_service_stmt


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
            LeadService.external_id,
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
        "packages": [],
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
                    LeadService.external_id,
                    LeadService.created_by.label("created_by_user_id"),
                    User.name.label("created_by_name"),
                    LeadService.created_at,
                ).outerjoin(User, User.id == LeadService.created_by).where(LeadService.id == service_id)
            )
        ).mappings().first()
        if current is None:
            return None
        packages = [
            dict(pkg)
            for pkg in (await session.execute(packages_by_service_stmt([service_id], True))).mappings().all()
        ]
        if not values:
            return {**dict(current), "created_at": _fmt_ts(current["created_at"]), "packages": packages}

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
                            LeadService.external_id,
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
        "packages": packages,
    }


async def is_erp_managed(service_id: int) -> bool:
    async with session_scope() as session:
        external_id = await session.scalar(select(LeadService.external_id).where(LeadService.id == service_id))
    return bool(external_id)


async def create_service_package(service_id: int, values: dict) -> dict | None:
    """Agrega una presentación al servicio. ``None`` si el servicio no existe.
    Nace al final de la lista salvo que se indique ``position``."""
    async with session_scope() as session:
        exists = await session.scalar(select(LeadService.id).where(LeadService.id == service_id))
        if exists is None:
            return None
        if values.get("position") is None:
            last = await session.scalar(
                select(func.max(ServicePackage.position)).where(ServicePackage.service_id == service_id)
            )
            values["position"] = 0 if last is None else last + 1
        try:
            async with session.begin_nested():
                row = (
                    await session.execute(
                        insert(ServicePackage)
                        .values(service_id=service_id, is_active=True, **values)
                        .returning(*PACKAGE_COLUMNS)
                    )
                ).mappings().one()
        except IntegrityError:
            raise ServicePackageAlreadyExistsError(values.get("name", ""))
    return dict(row)


async def update_service_package(service_id: int, package_id: int, values: dict) -> dict | None:
    """``service_id`` va en el WHERE: la URL no puede tocar paquetes de otro servicio."""
    async with session_scope() as session:
        where = (ServicePackage.id == package_id) & (ServicePackage.service_id == service_id)
        if not values:
            row = (await session.execute(select(*PACKAGE_COLUMNS).where(where))).mappings().first()
            return dict(row) if row else None
        try:
            async with session.begin_nested():
                row = (
                    await session.execute(
                        update(ServicePackage).where(where).values(**values).returning(*PACKAGE_COLUMNS)
                    )
                ).mappings().first()
        except IntegrityError:
            raise ServicePackageAlreadyExistsError(values.get("name", ""))
    return dict(row) if row else None


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

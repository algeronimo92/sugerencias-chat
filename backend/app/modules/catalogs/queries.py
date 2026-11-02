"""Lado de lectura de los catálogos: etiquetas y servicios."""

from sqlalchemy import func, select, true
from app.db.models.catalogs import LeadService, LeadTag
from app.db.models.auth import User
from app.db.uow import session_scope
from app.core.time_format import iso_utc_micros as _fmt_ts


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

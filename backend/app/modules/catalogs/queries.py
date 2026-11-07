"""Lado de lectura de los catálogos: etiquetas y servicios."""

from sqlalchemy import func, select, true
from collections import defaultdict

from app.db.models.catalogs import LeadService, LeadTag, ServicePackage
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
_SERVICE_AI_COLUMNS = (LeadService.description, LeadService.price_notes)

PACKAGE_COLUMNS = (
    ServicePackage.id,
    ServicePackage.service_id,
    ServicePackage.name,
    ServicePackage.sessions,
    ServicePackage.price,
    ServicePackage.notes,
    ServicePackage.position,
    ServicePackage.is_active,
)


def packages_by_service_stmt(service_ids: list[int], include_inactive: bool):
    """Paquetes de varios servicios en el orden en que el negocio los muestra."""
    stmt = (
        select(*PACKAGE_COLUMNS)
        .where(ServicePackage.service_id.in_(service_ids))
        .order_by(ServicePackage.service_id, ServicePackage.position, ServicePackage.id)
    )
    if not include_inactive:
        stmt = stmt.where(ServicePackage.is_active == true())
    return stmt


async def _packages_grouped(session, service_ids: list[int], include_inactive: bool) -> dict[int, list[dict]]:
    grouped: dict[int, list[dict]] = defaultdict(list)
    if not service_ids:
        return grouped
    rows = (await session.execute(packages_by_service_stmt(service_ids, include_inactive))).mappings().all()
    for row in rows:
        grouped[row["service_id"]].append(dict(row))
    return grouped


async def list_lead_services(include_inactive: bool = False) -> list[dict]:
    """Servicios con sus paquetes. ``include_inactive`` aplica a ambos: el
    admin ve todo para poder reactivar; el equipo solo lo vendible."""
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
        packages = await _packages_grouped(session, [row["id"] for row in rows], include_inactive)
    return [
        {**dict(row), "created_at": _fmt_ts(row["created_at"]), "packages": packages.get(row["id"], [])}
        for row in rows
    ]


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

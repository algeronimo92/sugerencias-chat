"""Read-only projection owned by this capability, consumed by AI."""
from collections import defaultdict

from sqlalchemy import func, select, true
from app.db.models.catalogs import LeadService, ServicePackage
from app.db.uow import session_scope

async def list_ai_catalog_rows() -> list[dict]:
    """Servicios activos con lo que el asistente necesita para cotizar: sus
    paquetes activos (nombre, sesiones, precio total) en el orden del negocio."""

    async with session_scope() as session:
        rows = (
            await session.execute(
                select(
                    LeadService.id,
                    LeadService.name,
                )
                .where(LeadService.is_active == true())
                .order_by(func.lower(LeadService.name).asc())
            )
        ).mappings().all()
        packages: dict[int, list[dict]] = defaultdict(list)
        if rows:
            package_rows = (
                await session.execute(
                    select(
                        ServicePackage.service_id,
                        ServicePackage.name,
                        ServicePackage.sessions,
                        ServicePackage.price,
                        ServicePackage.notes,
                    )
                    .where(
                        ServicePackage.is_active == true(),
                        ServicePackage.service_id.in_([row["id"] for row in rows]),
                    )
                    .order_by(ServicePackage.service_id, ServicePackage.position, ServicePackage.id)
                )
            ).mappings().all()
            for package in package_rows:
                packages[package["service_id"]].append(dict(package))
    return [{**dict(row), "packages": packages.get(row["id"], [])} for row in rows]

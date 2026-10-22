"""Read-only projection owned by this capability, consumed by AI."""
from sqlalchemy import func, select, true
from app.db.models.catalogs import LeadService
from app.db.uow import session_scope

async def list_ai_catalog_rows() -> list[dict]:
    """Servicios activos con lo que el asistente necesita para cotizar."""

    async with session_scope() as session:
        rows = (
            await session.execute(
                select(
                    LeadService.id,
                    LeadService.name,
                    LeadService.description,
                    LeadService.price,
                    LeadService.price_notes,
                )
                .where(LeadService.is_active == true())
                .order_by(func.lower(LeadService.name).asc())
            )
        ).mappings().all()
    return list(rows)

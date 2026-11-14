"""Lo que muestra la tarjeta de la API de Conversiones: cuántos eventos se
mandaron y los últimos, con el lead y la cita de cada uno."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select

from app.db.models.leads import Lead, MetaConversionEvent
from app.db.uow import session_scope

SUMMARY_DAYS = 30
RECENT_LIMIT = 10


async def conversions_summary(*, now: datetime | None = None) -> dict:
    since = (now or datetime.now(timezone.utc)) - timedelta(days=SUMMARY_DAYS)
    async with session_scope() as session:
        counts = dict((await session.execute(
            select(MetaConversionEvent.status, func.count())
            .where(MetaConversionEvent.created_at >= since)
            .group_by(MetaConversionEvent.status)
        )).all())
        rows = (await session.execute(
            select(
                MetaConversionEvent.id, MetaConversionEvent.lead_id,
                Lead.nombre.label("lead_name"), MetaConversionEvent.appointment_id,
                MetaConversionEvent.event_name, MetaConversionEvent.status,
                MetaConversionEvent.value, MetaConversionEvent.currency,
                MetaConversionEvent.attempts, MetaConversionEvent.last_error,
                MetaConversionEvent.created_at, MetaConversionEvent.sent_at,
            )
            .outerjoin(Lead, Lead.id == MetaConversionEvent.lead_id)
            .order_by(MetaConversionEvent.created_at.desc(), MetaConversionEvent.id.desc())
            .limit(RECENT_LIMIT)
        )).mappings().all()
    return {
        "days": SUMMARY_DAYS,
        "sent": int(counts.get("sent", 0)),
        "pending": int(counts.get("pending", 0)),
        "failed": int(counts.get("failed", 0)),
        "recent": [
            {**row, "value": float(row["value"]) if row["value"] is not None else None}
            for row in rows
        ],
    }

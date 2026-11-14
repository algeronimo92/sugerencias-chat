"""Lo que muestra el panel de la API de Conversiones: cómo van los envíos de
los últimos días por tipo de evento, el último error y qué proporción de los
leads trae un clic de anuncio (solo una parte lo trae: calibra expectativas)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import distinct, func, select

from app.db.models.leads import Lead, MetaConversionEvent, WhatsappAdConversion
from app.db.uow import session_scope
from app.modules.leads.attribution.events import EVENT_NAMES

SUMMARY_DAYS = 30
RECENT_LIMIT = 10
STATUSES = ("sent", "pending", "skipped", "failed")


async def conversions_summary(*, now: datetime | None = None) -> dict:
    since = (now or datetime.now(timezone.utc)) - timedelta(days=SUMMARY_DAYS)
    async with session_scope() as session:
        counts = (await session.execute(
            select(MetaConversionEvent.event_name, MetaConversionEvent.status, func.count())
            .where(MetaConversionEvent.created_at >= since)
            .group_by(MetaConversionEvent.event_name, MetaConversionEvent.status)
        )).all()
        last_error = (await session.execute(
            select(MetaConversionEvent.last_error, MetaConversionEvent.event_name, MetaConversionEvent.created_at)
            .where(MetaConversionEvent.last_error.isnot(None), MetaConversionEvent.status != "sent")
            .order_by(MetaConversionEvent.created_at.desc())
            .limit(1)
        )).mappings().first()
        recent = (await session.execute(
            select(
                MetaConversionEvent.id, MetaConversionEvent.lead_id, Lead.nombre.label("lead_name"),
                MetaConversionEvent.event_name, MetaConversionEvent.status, MetaConversionEvent.skip_reason,
                MetaConversionEvent.custom_data, MetaConversionEvent.last_error,
                MetaConversionEvent.created_at, MetaConversionEvent.sent_at,
            )
            .join(Lead, Lead.id == MetaConversionEvent.lead_id)
            .order_by(MetaConversionEvent.created_at.desc(), MetaConversionEvent.id.desc())
            .limit(RECENT_LIMIT)
        )).mappings().all()
        leads_total = await session.scalar(select(func.count()).select_from(Lead).where(Lead.created_at >= since))
        leads_with_click = await session.scalar(
            select(func.count(distinct(WhatsappAdConversion.lead_id)))
            .join(Lead, Lead.id == WhatsappAdConversion.lead_id)
            .where(Lead.created_at >= since, WhatsappAdConversion.ctwaclid.isnot(None))
        )

    by_event = {name: {status: 0 for status in STATUSES} for name in EVENT_NAMES}
    for event_name, status, count in counts:
        by_event.setdefault(event_name, {status: 0 for status in STATUSES})[status] = int(count)
    return {
        "days": SUMMARY_DAYS,
        "events": [{"event_name": name, **values} for name, values in by_event.items()],
        "last_error": dict(last_error) if last_error else None,
        "leads_total": int(leads_total or 0),
        "leads_with_click": int(leads_with_click or 0),
        "recent": [
            {
                **{key: value for key, value in row.items() if key != "custom_data"},
                "value": (row["custom_data"] or {}).get("value"),
                "currency": (row["custom_data"] or {}).get("currency"),
            }
            for row in recent
        ],
    }

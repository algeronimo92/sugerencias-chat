"""Lado de lectura de los costos de WhatsApp que informó Meta."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from sqlalchemy import func, select

from app.db.models.platform import WhatsAppPricingDaily
from app.db.uow import session_scope

# Mensajes de servicio gratis por número y por mes desde el 2026-10-01. El
# negocio tiene un solo número conectado, así que el cupo es el del negocio.
FREE_SERVICE_MESSAGES_PER_MONTH = 1000


def _month_bounds(month: date) -> tuple[date, date]:
    first = month.replace(day=1)
    following = date(first.year + 1, 1, 1) if first.month == 12 else date(first.year, first.month + 1, 1)
    return first, following


def _money(value: Decimal | None) -> float:
    return float(round(value or Decimal(0), 4))


async def monthly_costs(month: date) -> dict:
    first, following = _month_bounds(month)
    in_month = (WhatsAppPricingDaily.day >= first, WhatsAppPricingDaily.day < following)
    async with session_scope() as session:
        breakdown = (await session.execute(
            select(
                WhatsAppPricingDaily.pricing_category,
                WhatsAppPricingDaily.pricing_type,
                func.sum(WhatsAppPricingDaily.volume).label("volume"),
                func.sum(WhatsAppPricingDaily.cost).label("cost"),
            )
            .where(*in_month)
            .group_by(WhatsAppPricingDaily.pricing_category, WhatsAppPricingDaily.pricing_type)
            .order_by(func.sum(WhatsAppPricingDaily.cost).desc(), WhatsAppPricingDaily.pricing_category)
        )).all()
        days = (await session.execute(
            select(
                WhatsAppPricingDaily.day,
                func.sum(WhatsAppPricingDaily.volume).label("volume"),
                func.sum(WhatsAppPricingDaily.cost).label("cost"),
            )
            .where(*in_month)
            .group_by(WhatsAppPricingDaily.day)
            .order_by(WhatsAppPricingDaily.day)
        )).all()
        currency = await session.scalar(
            select(WhatsAppPricingDaily.currency)
            .where(WhatsAppPricingDaily.currency.isnot(None))
            .order_by(WhatsAppPricingDaily.synced_at.desc())
            .limit(1)
        )
        last_synced_at = await session.scalar(select(func.max(WhatsAppPricingDaily.synced_at)))

    free_service_used = sum(
        int(row.volume or 0) for row in breakdown
        if row.pricing_category == "SERVICE" and row.pricing_type == "FREE_CUSTOMER_SERVICE"
    )
    return {
        "month": first.strftime("%Y-%m"),
        "currency": currency,
        "total_cost": _money(sum((row.cost or Decimal(0) for row in breakdown), Decimal(0))),
        "billed_messages": sum(int(row.volume or 0) for row in breakdown if row.pricing_type == "REGULAR"),
        "free_messages": sum(int(row.volume or 0) for row in breakdown if row.pricing_type != "REGULAR"),
        "free_service_used": free_service_used,
        "free_service_limit": FREE_SERVICE_MESSAGES_PER_MONTH,
        "breakdown": [
            {
                "pricing_category": row.pricing_category,
                "pricing_type": row.pricing_type,
                "volume": int(row.volume or 0),
                "cost": _money(row.cost),
            }
            for row in breakdown
        ],
        "days": [
            {"day": row.day.isoformat(), "volume": int(row.volume or 0), "cost": _money(row.cost)}
            for row in days
        ],
        "last_synced_at": last_synced_at.isoformat() if last_synced_at else None,
    }

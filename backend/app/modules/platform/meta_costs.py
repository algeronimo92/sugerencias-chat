"""Sincroniza lo que Meta cobra por WhatsApp a la base del negocio.

Meta solo informa montos en ``pricing_analytics`` de la WABA (el webhook de
estado dice si un mensaje se cobra y con qué tarifa, no cuánto). Desde el
2026-10-01 se cobran también los mensajes de servicio pasados los 1.000
gratis del mes y las plantillas utility dentro de la ventana de 24 h: sin
esta copia el negocio no ve el gasto hasta que llega la factura.

El cliente de Meta llega inyectado (``fetch``): este módulo no habla con la
Graph API por su cuenta (ver ``META_ALLOWED`` en ``test_layering``).
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation

from sqlalchemy import delete, func, select

from app.db.models.platform import WhatsAppPricingDaily
from app.db.uow import session_scope

PricingFetcher = Callable[[datetime, datetime], Awaitable[dict]]

# Meta corrige las cifras de los últimos días: cada pasada vuelve a pedirlos.
RESYNC_DAYS = 3
# Cada cuánto el worker vuelve a consultar. Meta agrega por día y advierte
# que el dato es aproximado: no tiene sentido pedirlo más seguido.
SYNC_INTERVAL_SECONDS = 6 * 3600


def _first_of_previous_month(now: datetime) -> datetime:
    first = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return (first - timedelta(days=1)).replace(day=1)


def _ts(value) -> datetime | None:
    try:
        return datetime.fromtimestamp(int(value), tz=timezone.utc)
    except (TypeError, ValueError, OverflowError):
        return None


def _decimal(value) -> Decimal:
    try:
        return Decimal(str(value)) if value is not None else Decimal(0)
    except InvalidOperation:
        return Decimal(0)


def business_day(period_start: datetime, period_end: datetime) -> date:
    """Fecha local del día de Meta: la del punto medio del período en UTC."""
    return (period_start + (period_end - period_start) / 2).date()


def _rows(points: list[dict], currency: str | None, synced_at: datetime) -> list[dict]:
    """Un punto de Meta por fila; si Meta repite la combinación, se suman."""
    rows: dict[tuple, dict] = {}
    for point in points:
        start, end = _ts(point.get("start")), _ts(point.get("end"))
        category = point.get("pricing_category")
        pricing_type = point.get("pricing_type")
        if start is None or end is None or not category or not pricing_type:
            continue
        key = (
            business_day(start, end), str(point.get("country") or ""),
            str(category), str(pricing_type), str(point.get("tier") or ""),
        )
        row = rows.get(key)
        if row is None:
            rows[key] = {
                "day": key[0], "country": key[1], "pricing_category": key[2],
                "pricing_type": key[3], "tier": key[4],
                "period_start": start, "period_end": end,
                "volume": int(point.get("volume") or 0), "cost": _decimal(point.get("cost")),
                "currency": currency, "synced_at": synced_at,
            }
        else:
            row["volume"] += int(point.get("volume") or 0)
            row["cost"] += _decimal(point.get("cost"))
    return list(rows.values())


async def sync_meta_costs(fetch: PricingFetcher, *, now: datetime | None = None) -> int:
    """Trae de Meta los días pendientes y reemplaza esos días en la base.
    Devuelve cuántas filas quedaron guardadas."""
    now = now or datetime.now(timezone.utc)
    async with session_scope() as session:
        last_day = await session.scalar(select(func.max(WhatsAppPricingDaily.day)))
    if last_day is None:
        start = _first_of_previous_month(now)
    else:
        start = datetime.combine(last_day - timedelta(days=RESYNC_DAYS), datetime.min.time(), tzinfo=timezone.utc)
    result = await fetch(start, now)
    first_day = business_day(start, start + timedelta(days=1))
    # Meta corta los días en la zona de la WABA: el primer punto puede ser el
    # día anterior a ``start``, que ya está guardado y no se borra abajo.
    rows = [
        row for row in _rows(result.get("data_points") or [], result.get("currency"), now)
        if row["day"] >= first_day
    ]
    async with session_scope() as session:
        # Reemplazo por días: un punto que Meta dejó de informar (corrección
        # a cero) no puede quedar guardado con el valor viejo.
        await session.execute(delete(WhatsAppPricingDaily).where(WhatsAppPricingDaily.day >= first_day))
        if rows:
            await session.execute(WhatsAppPricingDaily.__table__.insert(), rows)
        await session.flush()
    return len(rows)

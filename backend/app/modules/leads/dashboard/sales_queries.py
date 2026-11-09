"""Ventas del período: cuánto entró, con qué paquetes y quién las cerró,
comparado con la ventana anterior de la misma duración.

Todo se mide por ``sold_at`` (la fecha de la venta, no la del registro) y, en
el scope propio, por quien vendió. Los importes son lo cobrado (``amount``);
el precio de lista solo sirve para medir el descuento. Las ventas conservan
copia del servicio y del paquete, así que una fila cuyo paquete ya no existe
en el catálogo (``package_id`` NULL) se sigue agrupando por esos nombres.

Los nombres de vendedor se resuelven por el contrato de auth y no con un JOIN:
este archivo no lee tablas de otros módulos.
"""

import asyncio
import re
from datetime import timedelta
from decimal import Decimal

from sqlalchemy import case, distinct, func, literal, select
from sqlalchemy.dialects.postgresql import aggregate_order_by, array_agg

from app.db.models.leads import Lead, LeadSale
from app.modules.ai.public import business_currency
from app.modules.auth.public import user_names
from app.modules.leads.dashboard.scope import DashboardScope, execute_mapping, local_day

RECENT_LIMIT = 8
UNKNOWN_SELLER = "Sin vendedor"
# El perfil IA acepta texto libre en la moneda ("S/", "soles"); solo un código
# ISO 4217 sirve para formatear importes en el navegador.
_ISO_CURRENCY = re.compile(r"^[A-Z]{3}$")


def _money(value) -> float:
    return float(Decimal(value or 0).quantize(Decimal("0.01")))


def _current(scope: DashboardScope):
    # Sin tope superior, como antes: una venta fechada por adelantado cuenta en
    # el período en que se registró en vez de desaparecer del panel.
    return (LeadSale.sold_at >= scope.start) & scope.mine(LeadSale.sold_by_user_id)


def _previous(scope: DashboardScope):
    return (
        (LeadSale.sold_at >= scope.previous_start)
        & (LeadSale.sold_at < scope.start)
        & scope.mine(LeadSale.sold_by_user_id)
    )


def _latest_name(column):
    """El nombre con que se vendió por última vez: si el catálogo renombró el
    paquete, la fila muestra el nombre actual y no el alfabéticamente mayor.
    Los arrays de PostgreSQL empiezan en 1."""
    return array_agg(aggregate_order_by(column, LeadSale.sold_at.desc()))[1]


# --- Totales ----------------------------------------------------------------

def _totals_stmt(condition):
    return select(
        func.count(LeadSale.id).label("count"),
        func.coalesce(func.sum(LeadSale.amount), 0).label("revenue"),
        func.coalesce(func.sum(LeadSale.list_price), 0).label("list_total"),
        func.coalesce(func.sum(LeadSale.sessions), 0).label("sessions"),
        func.count(distinct(LeadSale.lead_id)).label("buyers"),
    ).where(condition)


def _totals(row) -> dict:
    count = int(row["count"] or 0)
    revenue = Decimal(row["revenue"] or 0)
    list_total = Decimal(row["list_total"] or 0)
    # Un descuento negativo (se cobró más que la lista) no es descuento: se
    # muestra como cero en vez de restar del que dieron otros.
    discount = max(list_total - revenue, Decimal(0))
    return {
        "count": count,
        "revenue": _money(revenue),
        "avg_ticket": _money(revenue / count) if count else None,
        "sessions": int(row["sessions"] or 0),
        "discount": _money(discount),
        "discount_rate": round(float(discount / list_total * 100), 1) if list_total else None,
        "buyers": int(row["buyers"] or 0),
    }


# --- Tendencia --------------------------------------------------------------

def _trend_stmt(condition):
    day = local_day(LeadSale.sold_at)
    return (
        select(
            day.label("day"),
            func.count(LeadSale.id).label("count"),
            func.coalesce(func.sum(LeadSale.amount), 0).label("revenue"),
        )
        .where(condition)
        .group_by(day)
        .order_by(day)
    )


def _trend(rows, first_day, days: int) -> list[dict]:
    """Un punto por día, con ceros donde no hubo ventas: la serie anterior se
    alinea con la actual por posición, así que las dos tienen que tener el
    mismo largo aunque una ventana esté vacía."""
    by_day = {row["day"]: row for row in rows}
    points = []
    for offset in range(days):
        day = first_day + timedelta(days=offset)
        row = by_day.get(day)
        points.append({
            "date": day.isoformat(),
            "count": int(row["count"]) if row else 0,
            "revenue": _money(row["revenue"]) if row else 0.0,
        })
    return points


# --- Por paquete y por servicio ---------------------------------------------

# Sin paquete en el catálogo, la fila se identifica por los nombres copiados.
_ORPHAN_SERVICE = case((LeadSale.package_id.is_(None), LeadSale.service_name))
_ORPHAN_PACKAGE = case((LeadSale.package_id.is_(None), LeadSale.package_name))


def _package_stmt(condition):
    return (
        select(
            LeadSale.package_id.label("package_id"),
            _latest_name(LeadSale.service_name).label("service_name"),
            _latest_name(LeadSale.package_name).label("package_name"),
            func.max(LeadSale.sessions).label("sessions"),
            func.count(LeadSale.id).label("count"),
            func.coalesce(func.sum(LeadSale.amount), 0).label("revenue"),
        )
        .where(condition)
        .group_by(LeadSale.package_id, _ORPHAN_SERVICE, _ORPHAN_PACKAGE)
    )


def _package_key(row) -> tuple:
    if row["package_id"] is not None:
        return ("id", int(row["package_id"]))
    return ("name", row["service_name"], row["package_name"])


def _packages(current_rows, previous_rows) -> list[dict]:
    previous = {_package_key(row): int(row["count"]) for row in previous_rows}
    packages = []
    for row in current_rows:
        count = int(row["count"])
        revenue = Decimal(row["revenue"] or 0)
        packages.append({
            "package_id": int(row["package_id"]) if row["package_id"] is not None else None,
            "service_name": str(row["service_name"]),
            "package_name": str(row["package_name"]),
            "sessions": int(row["sessions"] or 1),
            "count": count,
            "revenue": _money(revenue),
            "avg_ticket": _money(revenue / count) if count else None,
            "previous_count": previous.get(_package_key(row), 0),
        })
    # Por ingresos y, a igual monto, por cantidad y nombre: el orden tiene que
    # ser estable para que la tabla no salte entre recargas.
    packages.sort(key=lambda p: (-p["revenue"], -p["count"], p["service_name"], p["package_name"]))
    return packages


def _service_stmt(condition):
    return (
        select(
            LeadSale.service_id.label("service_id"),
            _latest_name(LeadSale.service_name).label("name"),
            func.count(LeadSale.id).label("count"),
            func.coalesce(func.sum(LeadSale.amount), 0).label("revenue"),
        )
        .where(condition)
        .group_by(LeadSale.service_id, case((LeadSale.service_id.is_(None), LeadSale.service_name)))
        .order_by(func.sum(LeadSale.amount).desc(), func.count(LeadSale.id).desc())
    )


def _services(rows) -> list[dict]:
    return [
        {
            "service_id": int(row["service_id"]) if row["service_id"] is not None else None,
            "name": str(row["name"]),
            "count": int(row["count"]),
            "revenue": _money(row["revenue"]),
        }
        for row in rows
    ]


# --- Por vendedor -----------------------------------------------------------

def _seller_stmt(scope: DashboardScope):
    # El ranking del equipo nunca se acota al scope: es la comparativa que el
    # vendedor ve junto a lo suyo, igual que los demás rankings del dashboard.
    return (
        select(
            LeadSale.sold_by_user_id.label("user_id"),
            func.count(LeadSale.id).label("count"),
            func.coalesce(func.sum(LeadSale.amount), 0).label("revenue"),
            func.coalesce(func.sum(LeadSale.list_price), 0).label("list_total"),
        )
        .where(LeadSale.sold_at >= scope.start)
        .group_by(LeadSale.sold_by_user_id)
        .order_by(func.sum(LeadSale.amount).desc(), func.count(LeadSale.id).desc())
    )


def _sellers(rows, names: dict[int, str]) -> list[dict]:
    sellers = []
    for row in rows:
        count = int(row["count"])
        revenue = Decimal(row["revenue"] or 0)
        list_total = Decimal(row["list_total"] or 0)
        discount = max(list_total - revenue, Decimal(0))
        user_id = row["user_id"]
        sellers.append({
            "user_id": int(user_id) if user_id is not None else None,
            "name": names.get(user_id, UNKNOWN_SELLER) if user_id is not None else UNKNOWN_SELLER,
            "count": count,
            "revenue": _money(revenue),
            "avg_ticket": _money(revenue / count) if count else None,
            "discount_rate": round(float(discount / list_total * 100), 1) if list_total else None,
        })
    return sellers


# --- Últimas compras --------------------------------------------------------

def _recent_stmt(condition):
    # El lead es tabla de este mismo módulo; el nombre cae al usuario de
    # WhatsApp y al teléfono como hace la bandeja.
    lead_name = func.coalesce(Lead.nombre, Lead.nombre_usuario, Lead.telefono, literal("Sin nombre"))
    return (
        select(
            LeadSale.id.label("id"),
            LeadSale.lead_id.label("lead_id"),
            lead_name.label("lead_name"),
            LeadSale.service_name.label("service_name"),
            LeadSale.package_name.label("package_name"),
            LeadSale.amount.label("amount"),
            LeadSale.list_price.label("list_price"),
            LeadSale.sold_at.label("sold_at"),
            LeadSale.sold_by_user_id.label("sold_by_user_id"),
        )
        .join(Lead, Lead.id == LeadSale.lead_id)
        .where(condition)
        .order_by(LeadSale.sold_at.desc(), LeadSale.id.desc())
        .limit(RECENT_LIMIT)
    )


def _recent(rows, names: dict[int, str]) -> list[dict]:
    return [
        {
            "id": int(row["id"]),
            "lead_id": str(row["lead_id"]),
            "lead_name": str(row["lead_name"]),
            "service_name": str(row["service_name"]),
            "package_name": str(row["package_name"]),
            "amount": _money(row["amount"]),
            "list_price": _money(row["list_price"]),
            "sold_at": row["sold_at"].isoformat(),
            "seller_name": names.get(row["sold_by_user_id"], UNKNOWN_SELLER),
        }
        for row in rows
    ]


async def _currency() -> str | None:
    value = await business_currency()
    return value if value and _ISO_CURRENCY.match(value) else None


async def collect(scope: DashboardScope) -> dict:
    current, previous = _current(scope), _previous(scope)
    (
        totals_rows, previous_rows, trend_rows, previous_trend_rows,
        package_rows, previous_package_rows, service_rows, seller_rows, recent_rows, currency,
    ) = await asyncio.gather(
        execute_mapping(_totals_stmt(current)),
        execute_mapping(_totals_stmt(previous)),
        execute_mapping(_trend_stmt(current)),
        execute_mapping(_trend_stmt(previous)),
        execute_mapping(_package_stmt(current)),
        execute_mapping(_package_stmt(previous)),
        execute_mapping(_service_stmt(current)),
        execute_mapping(_seller_stmt(scope)),
        execute_mapping(_recent_stmt(current)),
        _currency(),
    )
    names = await user_names(
        {row["user_id"] for row in seller_rows} | {row["sold_by_user_id"] for row in recent_rows}
    )
    previous_totals = _totals(previous_rows[0])
    return {
        "currency": currency,
        "totals": _totals(totals_rows[0]),
        # Sin ventas en la ventana anterior no hay contra qué comparar: el
        # frontend lo dice en texto en vez de mostrar un "+100 %" inventado.
        "previous": previous_totals if previous_totals["count"] else None,
        "trend": _trend(trend_rows, scope.start_date, scope.days),
        "previous_trend": _trend(previous_trend_rows, scope.start_date - timedelta(days=scope.days), scope.days),
        "by_package": _packages(package_rows, previous_package_rows),
        "by_service": _services(service_rows),
        "by_seller": _sellers(seller_rows, names),
        "recent": _recent(recent_rows, names),
    }

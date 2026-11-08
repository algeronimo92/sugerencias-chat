"""Compras del lead: el cierre concreto, con paquete y monto.

El interés del lead es el servicio (el problema que quiere resolver); lo que
el vendedor cierra es un paquete. Registrar la compra copia el paquete tal
como está hoy en el catálogo (nombre, sesiones, precio de lista) porque el
catálogo cambia y la venta no debe cambiar con él.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

from app.db.uow import collect, unit_of_work
from app.modules.catalogs.ports.packages import get_sellable_package
from app.modules.leads.application.commands import change_stage
from app.modules.leads.application.ports import lead_repository
from app.modules.leads.domain.errors import LeadNotFound, PackageNotAvailable, SaleNotEditable, SaleNotFound
from app.modules.leads.domain.events import LeadSaleChanged
from app.modules.leads.domain.lead import Actor

PackageLookup = Callable[[int, int], Awaitable[dict | None]]


@dataclass(frozen=True)
class SaleInput:
    service_id: int
    package_id: int
    # Lo cobrado; en blanco es el precio de lista.
    amount: Decimal | None = None
    notes: str | None = None
    sold_at: datetime | None = None


async def record_sale(
    lead_id: str,
    sale: SaleInput,
    *,
    actor: Actor,
    lookup_package: PackageLookup = get_sellable_package,
) -> dict[str, Any]:
    repository = lead_repository()
    async with unit_of_work():
        lead = await repository.get_for_update(lead_id)
        if lead is None:
            raise LeadNotFound()
        package = await lookup_package(sale.service_id, sale.package_id)
        if package is None:
            raise PackageNotAvailable(sale.service_id, sale.package_id)
        list_price = Decimal(package["price"]).quantize(Decimal("0.01"))
        amount = list_price if sale.amount is None else Decimal(sale.amount).quantize(Decimal("0.01"))
        row = await repository.add_sale(lead_id, {
            "service_id": package["service_id"],
            "package_id": package["package_id"],
            "service_name": package["service_name"],
            "package_name": package["package_name"],
            "sessions": package["sessions"],
            "list_price": list_price,
            "amount": amount,
            "notes": (sale.notes or "").strip() or None,
            "sold_by_user_id": actor.user_id,
            "sold_at": sale.sold_at or datetime.now(timezone.utc),
            "created_by_user_id": actor.user_id,
        })
        lead.record_sale(row, actor=actor)
        await repository.save(lead)
        collect(LeadSaleChanged(lead_id=lead_id, actor=actor, sale_id=row["id"]))
    return row


async def delete_sale(lead_id: str, sale_id: int, *, actor: Actor, is_admin: bool) -> None:
    """Borra una compra mal registrada. Queda rastro en el historial del lead."""
    repository = lead_repository()
    async with unit_of_work():
        lead = await repository.get_for_update(lead_id)
        if lead is None:
            raise LeadNotFound()
        row = await repository.get_sale(lead_id, sale_id)
        if row is None:
            raise SaleNotFound(sale_id)
        if not is_admin and row["created_by_user_id"] != actor.user_id:
            raise SaleNotEditable(sale_id)
        await repository.delete_sale(lead_id, sale_id)
        lead.record_sale(row, actor=actor, deleted=True)
        await repository.save(lead)
        collect(LeadSaleChanged(lead_id=lead_id, actor=actor, sale_id=sale_id, deleted=True))


async def close_with_sale(
    lead_id: str,
    stage: str,
    sale: SaleInput,
    *,
    actor: Actor,
    lookup_package: PackageLookup = get_sellable_package,
) -> dict[str, Any]:
    """Mover el lead a la etapa ganada y registrar qué compró, en una sola
    transacción: si el paquete ya no se vende, el lead no se mueve."""
    async with unit_of_work():
        await change_stage(lead_id, stage, actor=actor)
        return await record_sale(lead_id, sale, actor=actor, lookup_package=lookup_package)

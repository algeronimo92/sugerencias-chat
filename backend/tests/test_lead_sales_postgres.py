"""Compras contra PostgreSQL real: la fila copia el paquete, la lista trae al
vendedor, el lead crudo lleva ``compras`` para la IA y el dashboard suma."""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

from app.db.models.auth import User
from app.db.uow import session_scope
from app.modules.catalogs.service import create_lead_service, create_service_package
from app.modules.leads.application.sales import SaleInput, record_sale, delete_sale
from app.modules.leads.dashboard.leads_queries import collect_sales
from app.modules.leads.dashboard.scope import build_scope
from app.modules.leads.domain.lead import Actor
from app.modules.leads.infrastructure.repository import ensure_lead_stub
from app.modules.leads.queries import fetch_lead_raw, list_lead_activity, list_lead_sales
from app.tenancy.context import tenant_context
from tests.postgres_fixtures import app_engine, pg_dsn, tenant  # noqa: F401


async def _user(name: str, role: str = "vendedor") -> int:
    async with session_scope() as session:
        user = User(
            email=f"{name.lower()}-{uuid4().hex[:6]}@example.test", name=name, password_hash="!",
            role=role, is_active=True, created_at=datetime.now(timezone.utc),
        )
        session.add(user)
        await session.flush()
        return user.id


async def test_sales_round_trip_and_dashboard(tenant) -> None:
    with tenant_context(tenant):
        seller_id = await _user("Lucía")
        other_id = await _user("Marco")
        service = await create_lead_service("Hollywood Peel - Rostro", seller_id)
        single = await create_service_package(service["id"], {"name": "Individual", "sessions": 1, "price": Decimal("180"), "notes": None, "position": None})
        pack = await create_service_package(service["id"], {"name": "x3", "sessions": 3, "price": Decimal("400"), "notes": None, "position": None})
        lead_id = str(uuid4())
        await ensure_lead_stub(lead_id, None, None)

        sale = await record_sale(lead_id, SaleInput(service_id=service["id"], package_id=pack["id"], amount=Decimal("380")), actor=Actor.user(seller_id))
        await record_sale(lead_id, SaleInput(service_id=service["id"], package_id=single["id"]), actor=Actor.user(other_id))

        listed = await list_lead_sales(lead_id)
        assert [(s["package_name"], str(s["amount"]), str(s["list_price"]), s["sold_by_name"]) for s in listed] == [
            ("Individual", "180.00", "180.00", "Marco"),
            ("x3", "380.00", "400.00", "Lucía"),
        ]

        raw = await fetch_lead_raw(lead_id)
        assert [c["paquete"] for c in raw["compras"]] == ["Individual", "x3"]
        assert raw["compras"][1]["monto"] == "380.00"

        team = await collect_sales(build_scope(30, "team", seller_id))
        assert (team["count"], team["total"], team["avg_ticket"]) == (2, 560.0, 280.0)
        assert team["by_seller"] == [{"name": "Lucía", "value": 380}, {"name": "Marco", "value": 180}]
        assert team["by_package"] == [
            {"name": "Hollywood Peel - Rostro · Individual", "value": 1},
            {"name": "Hollywood Peel - Rostro · x3", "value": 1},
        ]
        mine = await collect_sales(build_scope(30, "mine", seller_id))
        assert (mine["count"], mine["total"]) == (1, 380.0)

        # Borrar deja rastro en el historial y sale de la lista.
        await delete_sale(lead_id, sale["id"], actor=Actor.user(seller_id), is_admin=False)
        assert [s["package_name"] for s in await list_lead_sales(lead_id)] == ["Individual"]
        events = [a["event_type"] for a in await list_lead_activity(lead_id)]
        assert events[:3] == ["sale_deleted", "sale_recorded", "sale_recorded"]

        # El paquete desactivado ya no se puede vender, pero la venta hecha
        # conserva su copia.
        from app.modules.catalogs.service import update_service_package
        await update_service_package(service["id"], single["id"], {"is_active": False})
        try:
            await record_sale(lead_id, SaleInput(service_id=service["id"], package_id=single["id"]), actor=Actor.user(seller_id))
        except Exception as exc:  # PackageNotAvailable
            assert type(exc).__name__ == "PackageNotAvailable"
        else:
            raise AssertionError("debió rechazar el paquete inactivo")
        assert (await list_lead_sales(lead_id))[0]["package_name"] == "Individual"

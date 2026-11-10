"""Separaciones de cita (la venta del negocio) en el dashboard, contra PostgreSQL.

El adelanto puede estar en el campo fijo o en el campo personalizado
"adelanto", como número o como texto: la consulta tiene que leer los dos con la
misma regla que la app y no romperse con un texto que no es número.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from uuid import uuid4

from app.db.models.appointments import Appointment
from app.db.models.auth import User
from app.db.uow import session_scope
from app.modules.leads.dashboard.appointments_queries import collect
from app.modules.leads.dashboard.scope import build_scope
from app.tenancy.context import tenant_context
from tests.postgres_fixtures import app_engine, pg_dsn, tenant  # noqa: F401


async def _user(name: str) -> int:
    async with session_scope() as session:
        user = User(
            email=f"{name.lower()}-{uuid4().hex[:6]}@example.test", name=name, password_hash="!",
            role="vendedor", is_active=True, created_at=datetime.now(timezone.utc),
        )
        session.add(user)
        await session.flush()
        return user.id


async def _separation(user_id: int, *, phone: str, adelanto: str = "0", custom=None, status: str = "created",
                      test: bool = False, days_ago: int = 0, treatment: str = "Hifu12D") -> None:
    async with session_scope() as session:
        session.add(Appointment(
            created_by_user_id=user_id, nombre_completo="Cliente", telefono=phone, tratamiento=treatment,
            fecha=date(2026, 12, 1), hora="10:00", vendedor="x", status=status, test_mode=test,
            adelanto=Decimal(adelanto), custom_fields={"adelanto": custom} if custom is not None else {},
            created_at=datetime.now(timezone.utc) - timedelta(days=days_ago),
        ))


async def test_separations_sum_deposits_from_both_fields_and_skip_what_is_not_a_booking(tenant) -> None:
    with tenant_context(tenant):
        lucia = await _user("Lucía")
        marco = await _user("Marco")
        await _separation(lucia, phone="111", adelanto="100")             # campo fijo
        await _separation(lucia, phone="111", custom=50)                  # personalizado, número; misma clienta
        await _separation(lucia, phone="222", custom="30.5")              # personalizado, texto con número
        await _separation(lucia, phone="333", custom="yape")              # texto que no es número: 0
        await _separation(lucia, phone="444", custom=80, status="duplicate")
        await _separation(lucia, phone="555", custom=80, test=True)
        await _separation(marco, phone="666", custom=200)
        await _separation(lucia, phone="777", custom=40, days_ago=40)     # ventana anterior

        team = (await collect(build_scope(30, "team", lucia)))["separations"]
        assert team["totals"] == {
            "count": 5, "amount": 380.5, "with_deposit": 4, "avg_deposit": 95.13, "clients": 4,
        }
        assert team["previous"] == {"count": 1, "amount": 40.0, "with_deposit": 1, "avg_deposit": 40.0, "clients": 1}
        assert sum(point["amount"] for point in team["trend"]) == 380.5
        assert [(s["name"], s["count"], s["amount"]) for s in team["by_seller"]] == [
            ("Marco", 1, 200.0), ("Lucía", 4, 180.5),
        ]
        assert len(team["recent"]) == 5 and team["recent"][0]["seller_name"] in {"Lucía", "Marco"}

        mine = (await collect(build_scope(30, "mine", lucia)))["separations"]
        assert (mine["totals"]["count"], mine["totals"]["amount"]) == (4, 180.5)
        # El ranking del equipo llega igual en el scope propio.
        assert [s["name"] for s in mine["by_seller"]] == ["Marco", "Lucía"]

        daily = (await collect(build_scope(30, "team", lucia)))["by_treatment_daily"]
        assert sum(row["amount"] for row in daily) == 380.5

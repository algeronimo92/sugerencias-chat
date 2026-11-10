"""Citas agendadas por tratamiento en el dashboard, contra PostgreSQL.

El tratamiento es texto libre del formulario: la consulta agrupa variantes de
escritura y descarta lo que no es una cita real (duplicadas, fallidas, de
prueba). Sin una base real el `regexp_replace` y el `mode()` no se prueban.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
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


async def _appointment(user_id: int, treatment: str, *, status: str = "created", test: bool = False, days_ago: int = 0) -> None:
    async with session_scope() as session:
        session.add(Appointment(
            created_by_user_id=user_id, nombre_completo="Cliente", telefono="999", tratamiento=treatment,
            fecha=date(2026, 12, 1), hora="10:00", vendedor="x", status=status, test_mode=test,
            created_at=datetime.now(timezone.utc) - timedelta(days=days_ago),
        ))


async def test_booked_appointments_group_spellings_and_skip_what_is_not_a_booking(tenant) -> None:
    with tenant_context(tenant):
        seller = await _user("Lucía")
        other = await _user("Marco")
        for treatment in ("Hifu12D", "Hifu12D", "HIFU 12D"):
            await _appointment(seller, treatment)
        await _appointment(seller, "Hollywood Peel x3", status="created_with_errors")
        await _appointment(seller, "Hollywood Peel x3", status="duplicate")
        await _appointment(seller, "Hollywood Peel x3", status="error")
        await _appointment(seller, "Hollywood Peel x3", test=True)
        await _appointment(seller, "Limpieza Facial", days_ago=45)
        await _appointment(other, "Limpieza Facial")

        team = await collect(build_scope(30, "team", seller))
        totals: dict[str, tuple[str, int]] = {}
        for row in team["by_treatment_daily"]:
            name, count = totals.get(row["key"], (row["name"], 0))
            totals[row["key"]] = (name, count + row["count"])
        assert totals == {
            # Se muestra la escritura que más se usó.
            "hifu12d": ("Hifu12D", 3),
            "hollywoodpeelx3": ("Hollywood Peel x3", 1),
            "limpiezafacial": ("Limpieza Facial", 1),
        }

        mine = await collect(build_scope(30, "mine", seller))
        assert {row["key"] for row in mine["by_treatment_daily"]} == {"hifu12d", "hollywoodpeelx3"}

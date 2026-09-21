"""Ventana temporal y helpers que comparten los bloques del dashboard.

El dashboard dejó de ser admin-only: un vendedor lo abre acotado a lo suyo
(`scope="mine"`) y el admin lo ve completo (`scope="team"`). Cada bloque recibe
el mismo `DashboardScope` y decide cómo aplicarlo — no todos filtran por la
misma columna: los leads por `vendedor_id`, las tareas por `assigned_user_id`,
los flujos por `started_by_user_id` y las citas por `created_by_user_id`.
"""

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import func, true

from db.session import get_sessionmaker


# Perú mantiene UTC-5 todo el año; el offset fijo evita depender del paquete
# tzdata en instalaciones Windows de Python.
BUSINESS_TIMEZONE = timezone(timedelta(hours=-5))
BUSINESS_TZ_NAME = "America/Lima"

SCOPE_MINE = "mine"
SCOPE_TEAM = "team"


@dataclass(frozen=True)
class DashboardScope:
    """Qué período y de quién se están midiendo las métricas."""

    days: int
    now: datetime
    start_date: date
    start: datetime
    scope: str
    user_id: int

    @property
    def is_mine(self) -> bool:
        return self.scope == SCOPE_MINE

    def mine(self, column):
        """Condición que acota una consulta al usuario, o `true()` cuando el
        scope es del equipo. Se pasa siempre a `.where(...)`, así la misma
        consulta sirve para los dos casos sin armarla dos veces."""
        return column == self.user_id if self.is_mine else true()


def build_scope(days: int, scope: str, user_id: int) -> DashboardScope:
    now = datetime.now(timezone.utc)
    local_today = now.astimezone(BUSINESS_TIMEZONE).date()
    start_date = local_today - timedelta(days=days - 1)
    return DashboardScope(
        days=days,
        now=now,
        start_date=start_date,
        start=datetime.combine(start_date, time.min, tzinfo=BUSINESS_TIMEZONE).astimezone(timezone.utc),
        scope=scope,
        user_id=user_id,
    )


def local_day(column):
    """Fecha local del negocio para agrupar series por día."""
    return func.date(func.timezone(BUSINESS_TZ_NAME, column))


async def execute_mapping(stmt):
    async with get_sessionmaker()() as session:
        return (await session.execute(stmt)).mappings().all()


def series(rows, scope: DashboardScope) -> list[dict]:
    """Rellena con ceros los días sin filas — un hueco en la serie dibujaría
    un salto en el área del gráfico en vez de un valle."""
    values = {row["day"]: int(row["total"]) for row in rows}
    return [
        {
            "date": (scope.start_date + timedelta(days=offset)).isoformat(),
            "value": values.get(scope.start_date + timedelta(days=offset), 0),
        }
        for offset in range(scope.days)
    ]


def items(rows) -> list[dict]:
    return [{"name": str(row["name"]), "value": int(row["value"])} for row in rows]

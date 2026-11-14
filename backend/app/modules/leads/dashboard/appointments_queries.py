"""Citas registradas desde el formulario del CRM, y la salud del agendamiento.

Dos atribuciones distintas conviven a propósito:

- **quién la registró** (`created_by_user_id`), que es lo que acota el scope
  propio — "cuántas citas cerré yo";
- **de quién es el lead** (`lead_id` -> `leads.vendedor_id`), que dice a qué
  cartera pertenece la cita aunque otra persona haya llenado el formulario.

`appointments.vendedor` sigue siendo texto libre del formulario, sin FK a
`users`, así que no se usa para atribuir: no distingue homónimos ni sigue al
catálogo de usuarios.
"""

import asyncio
from datetime import timedelta
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import Numeric, Text, and_, case, cast, distinct, func, select
from sqlalchemy.orm import aliased

from app.modules.leads.domain.types import LeadStageKind

from app.db.models.appointments import Appointment
from app.db.models.auth import User
from app.db.models.leads import Lead, LeadStage

from app.modules.leads.dashboard.scope import BUSINESS_TIMEZONE, DashboardScope, execute_mapping, items, local_day, series


# Los estados que devuelve n8n al registrar la cita (ck_appointments_status).
STATUS_LABELS = {
    "created": "Registrada",
    "duplicate": "Duplicada",
    "created_with_errors": "Con avisos",
    "error": "Falló",
}

UPCOMING_DAYS = 7
UPCOMING_LIMIT = 15

Owner = aliased(User)


def _scoped(stmt, scope: DashboardScope):
    return stmt.where(scope.mine(Appointment.created_by_user_id))


async def _upcoming(scope: DashboardScope) -> list[dict]:
    """Agenda de los próximos días, leída de las citas que se registraron.

    `hora` es texto del formulario y no se castea a `time`: un valor fuera de
    formato haría fallar la consulta entera del panel. Se ordena por (fecha,
    hora) como texto, que respeta el orden mientras la hora venga con dos
    dígitos, y el frontend lo muestra tal cual se registró.
    """
    today = scope.now.astimezone(BUSINESS_TIMEZONE).date()
    rows = await execute_mapping(
        _scoped(
            select(
                Appointment.id.label("id"),
                Appointment.lead_id.label("lead_id"),
                Appointment.nombre_completo.label("name"),
                Appointment.fecha.label("date"),
                Appointment.hora.label("time"),
                Appointment.tratamiento.label("treatment"),
            )
            .where(
                Appointment.status == "created",
                Appointment.test_mode.is_(False),
                Appointment.fecha >= today,
                Appointment.fecha < today + timedelta(days=UPCOMING_DAYS),
            )
            .order_by(Appointment.fecha, Appointment.hora)
            .limit(UPCOMING_LIMIT),
            scope,
        )
    )
    return [
        {
            "id": int(row["id"]),
            # None cuando el teléfono no identificó a un único lead: la cita se
            # muestra igual, pero sin enlace al chat.
            "lead_id": row["lead_id"],
            "name": str(row["name"]),
            "date": row["date"].isoformat(),
            "time": str(row["time"]),
            "treatment": row["treatment"],
        }
        for row in rows
    ]


async def _linkage(scope: DashboardScope) -> dict:
    """Cuántas citas quedaron colgadas de un lead. Una tasa baja avisa que los
    teléfonos del formulario no están coincidiendo con las fichas del CRM."""
    rows = await execute_mapping(
        _scoped(
            select(
                func.count(Appointment.id).label("total"),
                func.count(Appointment.id).filter(Appointment.lead_id.is_not(None)).label("linked"),
            ).where(Appointment.created_at >= scope.start),
            scope,
        )
    )
    row = rows[0]
    total = int(row["total"] or 0)
    linked = int(row["linked"] or 0)
    return {
        "total": total,
        "linked": linked,
        "unlinked": total - linked,
        "rate": round(linked / total * 100, 1) if total else None,
    }


async def _no_shows(scope: DashboardScope) -> dict:
    rows = await execute_mapping(
        select(
            func.count(Lead.id).filter(Lead.contador_noshow > 0).label("leads"),
            func.coalesce(func.sum(Lead.contador_noshow), 0).label("total"),
        ).where(scope.mine(Lead.vendedor_id))
    )
    row = rows[0]
    return {"leads": int(row["leads"] or 0), "total": int(row["total"] or 0)}


# Citas que quedaron agendadas de verdad: una duplicada o una que falló en n8n
# no es una venta, y las de prueba no son de ningún cliente.
BOOKED_STATUSES = ("created", "created_with_errors")

# El adelanto con la misma regla que Appointment.effective_adelanto: el campo
# fijo si trae monto; si no, el campo personalizado "adelanto", que es donde lo
# cargan los negocios que lo agregaron al formulario. Un texto que no es número
# vale 0 en vez de romper la consulta del panel.
_CUSTOM_DEPOSIT = Appointment.custom_fields["adelanto"]
DEPOSIT = case(
    (Appointment.adelanto > 0, Appointment.adelanto),
    (func.jsonb_typeof(_CUSTOM_DEPOSIT) == "number", func.greatest(_CUSTOM_DEPOSIT.astext.cast(Numeric), 0)),
    (
        (func.jsonb_typeof(_CUSTOM_DEPOSIT) == "string")
        & _CUSTOM_DEPOSIT.astext.op("~")(r"^\s*[0-9]+(\.[0-9]+)?\s*$"),
        func.trim(_CUSTOM_DEPOSIT.astext).cast(Numeric),
    ),
    else_=0,
)


def _money(value) -> float:
    # Redondeo comercial: 95,125 es 95,13 y no el 95,12 del redondeo bancario.
    return float(Decimal(value or 0).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def _booked(scope: DashboardScope, start, end=None):
    """Separaciones de la ventana: citas agendadas de verdad, del scope."""
    conditions = [
        Appointment.created_at >= start,
        Appointment.status.in_(BOOKED_STATUSES),
        Appointment.test_mode.is_(False),
        scope.mine(Appointment.created_by_user_id),
    ]
    if end is not None:
        conditions.append(Appointment.created_at < end)
    return and_(*conditions)


def _treatment_key(column):
    """El tratamiento es texto libre del formulario: "Hifu12D" y "HIFU 12D" son
    lo mismo. Se agrupa sin mayúsculas ni espacios; el nombre que se muestra es
    el que más se usó."""
    return func.lower(func.regexp_replace(column, r"\s+", "", "g"))


def _treatment_day_stmt(scope: DashboardScope):
    day = local_day(Appointment.created_at)
    key = _treatment_key(Appointment.tratamiento)
    return _scoped(
        select(
            day.label("day"),
            key.label("key"),
            func.mode().within_group(Appointment.tratamiento).label("name"),
            func.count(Appointment.id).label("count"),
            func.coalesce(func.sum(DEPOSIT), 0).label("amount"),
        )
        .where(
            Appointment.created_at >= scope.start,
            Appointment.status.in_(BOOKED_STATUSES),
            Appointment.test_mode.is_(False),
            func.length(func.trim(Appointment.tratamiento)) > 0,
        )
        .group_by(day, key)
        .order_by(day),
        scope,
    )


def _treatment_days(rows) -> list[dict]:
    return [
        {
            "date": row["day"].isoformat(), "key": str(row["key"]), "name": str(row["name"]),
            "count": int(row["count"]), "amount": _money(row["amount"]),
        }
        for row in rows
    ]


# --- Separaciones -------------------------------------------------------------
# La venta del negocio es la separación de una cita con su adelanto. Se mide
# por la fecha en que se registró la cita (cuando se cerró la separación), no
# por la fecha de la cita, y se compara con la ventana anterior de igual largo.

RECENT_LIMIT = 8


def _separation_totals_stmt(condition):
    return select(
        func.count(Appointment.id).label("count"),
        func.coalesce(func.sum(DEPOSIT), 0).label("amount"),
        func.count(Appointment.id).filter(DEPOSIT > 0).label("with_deposit"),
        # Una persona que separa dos tratamientos es una sola clienta: se
        # identifica por el lead y, si la cita no quedó ligada, por el teléfono.
        func.count(distinct(func.coalesce(cast(Appointment.lead_id, Text), Appointment.telefono))).label("clients"),
    ).where(condition)


def _separation_totals(row) -> dict:
    count = int(row["count"] or 0)
    with_deposit = int(row["with_deposit"] or 0)
    amount = Decimal(row["amount"] or 0)
    return {
        "count": count,
        "amount": _money(amount),
        "with_deposit": with_deposit,
        # Promedio sobre las que dejaron adelanto: una separación sin monto no
        # es un adelanto de 0 que baje el promedio.
        "avg_deposit": _money(amount / with_deposit) if with_deposit else None,
        "clients": int(row["clients"] or 0),
    }


def _separation_trend_stmt(condition):
    day = local_day(Appointment.created_at)
    return (
        select(day.label("day"), func.count(Appointment.id).label("count"), func.coalesce(func.sum(DEPOSIT), 0).label("amount"))
        .where(condition)
        .group_by(day)
        .order_by(day)
    )


def _separation_trend(rows, first_day, days: int) -> list[dict]:
    """Un punto por día con ceros donde no hubo separaciones: la serie
    anterior se alinea con la actual por posición."""
    by_day = {row["day"]: row for row in rows}
    points = []
    for offset in range(days):
        day = first_day + timedelta(days=offset)
        row = by_day.get(day)
        points.append({
            "date": day.isoformat(),
            "count": int(row["count"]) if row else 0,
            "amount": _money(row["amount"]) if row else 0.0,
        })
    return points


def _separation_ranking_stmt(scope: DashboardScope, name, *joins):
    # Ranking del equipo: no se acota al scope, como los demás rankings.
    stmt = select(
        name.label("name"),
        func.count(Appointment.id).label("count"),
        func.coalesce(func.sum(DEPOSIT), 0).label("amount"),
        func.count(Appointment.id).filter(DEPOSIT > 0).label("with_deposit"),
    )
    for target, on in joins:
        stmt = stmt.outerjoin(target, on)
    return (
        stmt.where(
            Appointment.created_at >= scope.start,
            Appointment.status.in_(BOOKED_STATUSES),
            Appointment.test_mode.is_(False),
        )
        .group_by(name)
        .order_by(func.sum(DEPOSIT).desc(), func.count(Appointment.id).desc())
        .limit(12)
    )


def _separation_seller_stmt(scope: DashboardScope):
    """Quién llenó el formulario de "Separar cita"."""
    return _separation_ranking_stmt(
        scope, func.coalesce(User.name, "Sin asignar"), (User, User.id == Appointment.created_by_user_id),
    )


def _separation_owner_stmt(scope: DashboardScope):
    """La vendedora a la que está asignada la clienta en el CRM, aunque la
    cita la haya registrado otra persona (una recepcionista, una compañera
    que cubrió el turno). Las citas sin lead quedan aparte en vez de
    desaparecer, y un lead sin vendedora se distingue de una cita sin lead."""
    name = case(
        (Appointment.lead_id.is_(None), "Sin lead vinculado"),
        else_=func.coalesce(Owner.name, "Lead sin vendedora"),
    )
    return _separation_ranking_stmt(
        scope, name, (Lead, Lead.id == Appointment.lead_id), (Owner, Owner.id == Lead.vendedor_id),
    )


def _separation_recent_stmt(condition):
    return (
        select(
            Appointment.id.label("id"),
            Appointment.lead_id.label("lead_id"),
            Appointment.nombre_completo.label("name"),
            Appointment.tratamiento.label("treatment"),
            DEPOSIT.label("amount"),
            Appointment.fecha.label("date"),
            Appointment.hora.label("time"),
            Appointment.created_at.label("created_at"),
            func.coalesce(User.name, "Sin asignar").label("seller_name"),
        )
        .outerjoin(User, User.id == Appointment.created_by_user_id)
        .where(condition)
        .order_by(Appointment.created_at.desc(), Appointment.id.desc())
        .limit(RECENT_LIMIT)
    )


def _ranking(rows) -> list[dict]:
    return [
        {
            "name": str(row["name"]), "count": int(row["count"]), "amount": _money(row["amount"]),
            "with_deposit": int(row["with_deposit"] or 0),
        }
        for row in rows
    ]


async def _separations(scope: DashboardScope) -> dict:
    current = _booked(scope, scope.start)
    previous = _booked(scope, scope.previous_start, scope.start)
    totals, previous_totals, trend, previous_trend, sellers, owners, recent = await asyncio.gather(
        execute_mapping(_separation_totals_stmt(current)),
        execute_mapping(_separation_totals_stmt(previous)),
        execute_mapping(_separation_trend_stmt(current)),
        execute_mapping(_separation_trend_stmt(previous)),
        execute_mapping(_separation_seller_stmt(scope)),
        execute_mapping(_separation_owner_stmt(scope)),
        execute_mapping(_separation_recent_stmt(current)),
    )
    before = _separation_totals(previous_totals[0])
    return {
        "totals": _separation_totals(totals[0]),
        # Sin separaciones en la ventana anterior no hay contra qué comparar.
        "previous": before if before["count"] else None,
        "trend": _separation_trend(trend, scope.start_date, scope.days),
        "previous_trend": _separation_trend(previous_trend, scope.start_date - timedelta(days=scope.days), scope.days),
        "by_seller": _ranking(sellers),
        "by_owner": _ranking(owners),
        "recent": [
            {
                "id": int(row["id"]),
                "lead_id": str(row["lead_id"]) if row["lead_id"] else None,
                "name": str(row["name"]),
                "treatment": str(row["treatment"]),
                "amount": _money(row["amount"]),
                "date": row["date"].isoformat(),
                "time": str(row["time"]),
                "created_at": row["created_at"].isoformat(),
                "seller_name": str(row["seller_name"]),
            }
            for row in recent
        ],
    }


async def collect(scope: DashboardScope) -> dict:
    status_stmt = _scoped(
        select(Appointment.status.label("name"), func.count(Appointment.id).label("value"))
        .where(Appointment.created_at >= scope.start)
        .group_by(Appointment.status),
        scope,
    )
    treatment_stmt = _scoped(
        select(Appointment.tratamiento.label("name"), func.count(Appointment.id).label("value"))
        .where(Appointment.created_at >= scope.start)
        .group_by(Appointment.tratamiento)
        .order_by(func.count(Appointment.id).desc())
        .limit(8),
        scope,
    )
    # Ranking del equipo por quien registró la cita.
    creator = func.coalesce(User.name, "Sin asignar")
    by_user_stmt = (
        select(creator.label("name"), func.count(Appointment.id).label("value"))
        .outerjoin(User, User.id == Appointment.created_by_user_id)
        .where(Appointment.created_at >= scope.start)
        .group_by(creator)
        .order_by(func.count(Appointment.id).desc())
        .limit(12)
    )
    # Ranking por dueño del lead: lo que habilita el vínculo cita -> lead. Las
    # citas sin vincular caen en su propio bucket en vez de desaparecer.
    owner = func.coalesce(Owner.name, "Sin lead vinculado")
    by_owner_stmt = (
        select(owner.label("name"), func.count(Appointment.id).label("value"))
        .outerjoin(Lead, Lead.id == Appointment.lead_id)
        .outerjoin(Owner, Owner.id == Lead.vendedor_id)
        .where(Appointment.created_at >= scope.start)
        .group_by(owner)
        .order_by(func.count(Appointment.id).desc())
        .limit(12)
    )
    day = local_day(Appointment.created_at)
    trend_stmt = _scoped(
        select(day.label("day"), func.count(Appointment.id).label("total"))
        .where(Appointment.created_at >= scope.start)
        .group_by(day)
        .order_by(day),
        scope,
    )
    lost_label = func.coalesce(Lead.razon_perdido, "Sin razón")
    lost_stmt = (
        select(lost_label.label("name"), func.count(Lead.id).label("value"))
        .where(
            Lead.estado.in_(select(LeadStage.key).where(LeadStage.kind == LeadStageKind.LOST)),
            scope.mine(Lead.vendedor_id),
        )
        .group_by(lost_label)
        .order_by(func.count(Lead.id).desc())
        .limit(8)
    )

    (
        statuses, treatments, by_user, by_owner, trend, lost, upcoming, no_shows, linkage, treatment_days, separations,
    ) = await asyncio.gather(
        execute_mapping(status_stmt),
        execute_mapping(treatment_stmt),
        execute_mapping(by_user_stmt),
        execute_mapping(by_owner_stmt),
        execute_mapping(trend_stmt),
        execute_mapping(lost_stmt),
        _upcoming(scope),
        _no_shows(scope),
        _linkage(scope),
        execute_mapping(_treatment_day_stmt(scope)),
        _separations(scope),
    )
    return {
        "by_status": [
            {"name": STATUS_LABELS.get(row["name"], str(row["name"])), "value": int(row["value"])}
            for row in statuses
        ],
        "by_treatment": items(treatments),
        "by_treatment_daily": _treatment_days(treatment_days),
        "separations": separations,
        "by_user": items(by_user),
        "by_owner": items(by_owner),
        "trend": series(trend, scope),
        "lost_reasons": items(lost),
        "upcoming": upcoming,
        "no_shows": no_shows,
        "linkage": linkage,
    }


# --- Exportación a Excel ------------------------------------------------------
# Las mismas citas que cuenta el panel, una por fila, para cuadrar con la caja
# y pagar comisiones. Siempre del equipo completo: exportar es de quien dirige.

def _appointment_export_stmt(condition):
    owner = case(
        (Appointment.lead_id.is_(None), "Sin lead vinculado"),
        else_=func.coalesce(Owner.name, "Lead sin vendedora"),
    )
    return (
        select(
            Appointment.created_at.label("created_at"),
            Appointment.fecha.label("date"),
            Appointment.hora.label("time"),
            Appointment.nombre_completo.label("name"),
            Appointment.dni.label("dni"),
            Appointment.telefono.label("phone"),
            Appointment.tratamiento.label("treatment"),
            DEPOSIT.label("amount"),
            Appointment.comprobante_filename.label("receipt"),
            Appointment.status.label("status"),
            func.coalesce(User.name, "Sin asignar").label("registered_by"),
            owner.label("owner"),
            Lead.origen.label("origin"),
        )
        .outerjoin(User, User.id == Appointment.created_by_user_id)
        .outerjoin(Lead, Lead.id == Appointment.lead_id)
        .outerjoin(Owner, Owner.id == Lead.vendedor_id)
        .where(condition)
        .order_by(Appointment.created_at, Appointment.id)
    )


def _appointment_export_rows(rows) -> list[dict]:
    return [
        {
            **dict(row),
            "amount": _money(row["amount"]),
            "status": STATUS_LABELS.get(row["status"], str(row["status"])),
            "time": str(row["time"]) if row["time"] is not None else None,
        }
        for row in rows
    ]


async def separation_export_rows(scope: DashboardScope) -> list[dict]:
    """Separaciones de la ventana con la misma regla que la pestaña Ventas."""
    return _appointment_export_rows(await execute_mapping(_appointment_export_stmt(_booked(scope, scope.start))))


async def appointment_export_rows() -> list[dict]:
    """Todas las citas reales para el respaldo, también las duplicadas o que
    fallaron: es una copia de los datos, no una métrica."""
    return _appointment_export_rows(
        await execute_mapping(_appointment_export_stmt(Appointment.test_mode.is_(False)))
    )


async def separations_by_user(scope: DashboardScope) -> dict[str, dict[int | None, dict]]:
    """Separaciones y adelantos por persona, de las dos formas que mira la
    dueña: las que registró y las de su cartera."""
    current = _booked(scope, scope.start)

    def by(column, *joins):
        stmt = select(
            column.label("user_id"),
            func.count(Appointment.id).label("count"),
            func.coalesce(func.sum(DEPOSIT), 0).label("amount"),
        )
        for target, on in joins:
            stmt = stmt.outerjoin(target, on)
        return stmt.where(current).group_by(column)

    registered, owned = await asyncio.gather(
        execute_mapping(by(Appointment.created_by_user_id)),
        execute_mapping(by(Lead.vendedor_id, (Lead, Lead.id == Appointment.lead_id))),
    )

    def keyed(rows):
        return {row["user_id"]: {"count": int(row["count"]), "amount": _money(row["amount"])} for row in rows}

    return {"registered": keyed(registered), "owned": keyed(owned)}

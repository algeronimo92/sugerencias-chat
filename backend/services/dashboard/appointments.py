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

from sqlalchemy import func, select
from sqlalchemy.orm import aliased

from db.models import Appointment, Lead, LeadStage, User

from .context import BUSINESS_TIMEZONE, DashboardScope, execute_mapping, items, local_day, series


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
        .where(Lead.estado == LeadStage.perdido, scope.mine(Lead.vendedor_id))
        .group_by(lost_label)
        .order_by(func.count(Lead.id).desc())
        .limit(8)
    )

    statuses, treatments, by_user, by_owner, trend, lost, upcoming, no_shows, linkage = await asyncio.gather(
        execute_mapping(status_stmt),
        execute_mapping(treatment_stmt),
        execute_mapping(by_user_stmt),
        execute_mapping(by_owner_stmt),
        execute_mapping(trend_stmt),
        execute_mapping(lost_stmt),
        _upcoming(scope),
        _no_shows(scope),
        _linkage(scope),
    )
    return {
        "by_status": [
            {"name": STATUS_LABELS.get(row["name"], str(row["name"])), "value": int(row["value"])}
            for row in statuses
        ],
        "by_treatment": items(treatments),
        "by_user": items(by_user),
        "by_owner": items(by_owner),
        "trend": series(trend, scope),
        "lost_reasons": items(lost),
        "upcoming": upcoming,
        "no_shows": no_shows,
        "linkage": linkage,
    }

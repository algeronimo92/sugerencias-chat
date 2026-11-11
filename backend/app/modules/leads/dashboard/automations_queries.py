"""Qué flujos se activaron, de qué tipo, quién los disparó y cómo terminaron.

La atribución sale de `automation_executions`: `start_source` distingue el
disparo a mano del vendedor (`manual`, con `started_by_user_id`) del
automático (`system`) y de un flujo que invocó a otro (`flow`).
"""

import asyncio

from sqlalchemy import func, select

from app.modules.automations.ports.types import AutomationExecutionStatus
from app.db.models.auth import User
from app.db.models.automations import AutomationExecution, AutomationRule

from app.modules.leads.dashboard.scope import (
    DashboardScope, execute_mapping, items, local_day, local_slot, local_weekday, series,
)


ACTIVE_STATUSES = (
    AutomationExecutionStatus.SCHEDULED,
    AutomationExecutionStatus.RUNNING,
    AutomationExecutionStatus.PAUSED,
)

SOURCE_LABELS = {
    "manual": "Iniciado a mano",
    # Era "Piloto automático"; "Flujos enviados" dice "automáticos" y un mismo
    # concepto con dos nombres se leía como dos cosas distintas.
    "system": "Automático",
    "flow": "Desde otro flujo",
}

# Un error de Postgres o de Meta trae identificadores y stack en la misma
# línea; agrupar por el texto completo daría un bucket por ejecución.
ERROR_SUMMARY_CHARS = 80


def _scoped(stmt, scope: DashboardScope):
    """Acota a lo que el vendedor disparó él mismo.

    `started_by_user_id` solo se llena en los disparos manuales, así que en
    scope propio las ejecuciones de sistema quedan fuera por definición: el
    panel responde "qué mandé yo", no "qué pasó en mis leads".
    """
    return stmt.where(scope.mine(AutomationExecution.started_by_user_id))


def is_automatic():
    """Lo que arrancó un disparador y lo que esos flujos llamaron.

    El `!= 'manual'` deja como "a mano" el envío de un usuario ya borrado, cuyo
    `started_by_user_id` quedó en NULL por el ON DELETE SET NULL. Todo lo que
    no es automático cuenta como a mano, así las dos series suman el total.
    """
    return AutomationExecution.started_by_user_id.is_(None) & (AutomationExecution.start_source != "manual")


def is_chained():
    """Lo inició otro flujo. No es un tercer origen: el encadenado hereda de su
    padre el `started_by_user_id`, así que sigue siendo a mano o automático y
    esto solo dice qué parte de cada uno llegó por otro flujo. Cuando era una
    categoría aparte, "a mano" daba dos cifras distintas en la misma pestaña."""
    return AutomationExecution.start_source == "flow"


def by_hour_stmt(scope: DashboardScope):
    """En scope propio solo hay flujos a mano: `started_by_user_id` no se llena
    en los automáticos, igual que en el resto del bloque de flujos."""
    weekday, slot = local_weekday(AutomationExecution.created_at), local_slot(AutomationExecution.created_at)
    return (
        select(
            weekday.label("weekday"),
            slot.label("slot"),
            func.count(AutomationExecution.id).filter(~is_automatic()).label("flows_manual"),
            func.count(AutomationExecution.id).filter(is_automatic()).label("flows_automatic"),
        )
        .where(
            AutomationExecution.created_at >= scope.start,
            scope.mine(AutomationExecution.started_by_user_id),
        )
        .group_by(weekday, slot)
    )


def manual_by_starter_hour_stmt(scope: DashboardScope):
    """Flujos a mano de todo el equipo, partidos por quien los inició: de acá
    sale la escala común con que se pintan los mapas de cada persona."""
    weekday, slot = local_weekday(AutomationExecution.created_at), local_slot(AutomationExecution.created_at)
    starter = AutomationExecution.started_by_user_id
    return (
        select(
            starter.label("person"), weekday.label("weekday"), slot.label("slot"),
            func.count(AutomationExecution.id).label("flows_manual"),
        )
        .where(AutomationExecution.created_at >= scope.start, starter.is_not(None))
        .group_by(starter, weekday, slot)
    )


async def _by_flow(scope: DashboardScope) -> list[dict]:
    status = AutomationExecution.status
    rows = await execute_mapping(
        _scoped(
            select(
                AutomationRule.name.label("name"),
                AutomationRule.id.label("rule_id"),
                AutomationRule.trigger_type.label("trigger_type"),
                func.count(AutomationExecution.id).label("value"),
                func.count(AutomationExecution.id)
                .filter(status == AutomationExecutionStatus.COMPLETED)
                .label("completed"),
                func.count(AutomationExecution.id)
                .filter(status == AutomationExecutionStatus.FAILED)
                .label("failed"),
                func.count(AutomationExecution.id)
                .filter(status == AutomationExecutionStatus.SKIPPED)
                .label("skipped"),
                func.count(AutomationExecution.id).filter(status.in_(ACTIVE_STATUSES)).label("active"),
                # Mismo corte que "Flujos por día" y el mapa de horas: si cada
                # panel partiera distinto, "a mano" daría tres cifras en la misma pestaña.
                func.count(AutomationExecution.id).filter(is_automatic()).label("automatic"),
                func.count(AutomationExecution.id).filter(is_chained()).label("chained"),
                func.count(AutomationExecution.id)
                .filter(is_chained() & is_automatic())
                .label("automatic_chained"),
                func.max(AutomationExecution.created_at).label("last_at"),
            )
            .join(AutomationRule, AutomationRule.id == AutomationExecution.rule_id)
            .where(AutomationExecution.created_at >= scope.start)
            .group_by(AutomationRule.id, AutomationRule.name, AutomationRule.trigger_type)
            .order_by(func.count(AutomationExecution.id).desc())
            .limit(12),
            scope,
        )
    )
    return [
        {
            "name": str(row["name"]),
            "rule_id": int(row["rule_id"]),
            "trigger_type": str(row["trigger_type"]),
            "value": int(row["value"]),
            "completed": int(row["completed"]),
            "failed": int(row["failed"]),
            "skipped": int(row["skipped"]),
            "active": int(row["active"]),
            # "A mano" es el resto, así las dos partes suman el total del flujo.
            "manual": int(row["value"]) - int(row["automatic"]),
            "automatic": int(row["automatic"]),
            # Parte de cada una que inició otro flujo; ya está contada arriba.
            "manual_chained": int(row["chained"]) - int(row["automatic_chained"]),
            "automatic_chained": int(row["automatic_chained"]),
            "last_at": row["last_at"].isoformat() if row["last_at"] else None,
        }
        for row in rows
    ]


async def _by_actor(scope: DashboardScope) -> list[dict]:
    """Ranking de quién dispara flujos a mano. Igual que la carga por vendedor,
    se sirve sin acotar al scope: es la comparativa del equipo."""
    # Sin nombre solo queda quien fue borrado después de iniciar el flujo. Decía
    # "Automático", y en un ranking de envíos a mano se leía como un error de conteo.
    actor = func.coalesce(User.name, "Usuario eliminado")
    rows = await execute_mapping(
        select(actor.label("name"), func.count(AutomationExecution.id).label("value"))
        .outerjoin(User, User.id == AutomationExecution.started_by_user_id)
        .where(
            AutomationExecution.created_at >= scope.start,
            AutomationExecution.start_source == "manual",
        )
        .group_by(actor)
        .order_by(func.count(AutomationExecution.id).desc())
        .limit(12)
    )
    return items(rows)


async def _failures(scope: DashboardScope) -> dict:
    error_label = func.left(AutomationExecution.error, ERROR_SUMMARY_CHARS)
    totals_stmt = _scoped(
        select(
            func.count(AutomationExecution.id).label("total"),
            func.count(AutomationExecution.id)
            .filter(AutomationExecution.status == AutomationExecutionStatus.FAILED)
            .label("failed"),
        ).where(AutomationExecution.created_at >= scope.start),
        scope,
    )
    errors_stmt = _scoped(
        select(error_label.label("name"), func.count(AutomationExecution.id).label("value"))
        .where(
            AutomationExecution.created_at >= scope.start,
            AutomationExecution.status == AutomationExecutionStatus.FAILED,
            AutomationExecution.error.is_not(None),
        )
        .group_by(error_label)
        .order_by(func.count(AutomationExecution.id).desc())
        .limit(5),
        scope,
    )
    totals, errors = await asyncio.gather(
        execute_mapping(totals_stmt), execute_mapping(errors_stmt)
    )
    total = int(totals[0]["total"] or 0)
    failed = int(totals[0]["failed"] or 0)
    return {
        "total": total,
        "failed": failed,
        "rate": round(failed / total * 100, 1) if total else None,
        "top_errors": items(errors),
    }


async def _active_now(scope: DashboardScope) -> dict:
    """Sin ventana temporal a propósito: una espera larga puede haber arrancado
    antes del período y sigue pendiente de enviar."""
    rows = await execute_mapping(
        _scoped(
            select(
                AutomationExecution.status.label("name"),
                func.count(AutomationExecution.id).label("value"),
            )
            .where(AutomationExecution.status.in_(ACTIVE_STATUSES))
            .group_by(AutomationExecution.status),
            scope,
        )
    )
    counts = {status.value: 0 for status in ACTIVE_STATUSES}
    for row in rows:
        counts[str(row["name"])] = int(row["value"])
    return counts


async def collect(scope: DashboardScope) -> dict:
    source_label = func.coalesce(AutomationExecution.start_source, "system")
    source_stmt = _scoped(
        select(source_label.label("name"), func.count(AutomationExecution.id).label("value"))
        .where(AutomationExecution.created_at >= scope.start)
        .group_by(source_label),
        scope,
    )
    trigger_stmt = _scoped(
        select(
            AutomationExecution.trigger_type.label("name"),
            func.count(AutomationExecution.id).label("value"),
        )
        .where(AutomationExecution.created_at >= scope.start)
        .group_by(AutomationExecution.trigger_type)
        .order_by(func.count(AutomationExecution.id).desc()),
        scope,
    )
    day = local_day(AutomationExecution.created_at)
    trend_stmt = _scoped(
        select(
            day.label("day"),
            func.count(AutomationExecution.id).label("total"),
            func.count(AutomationExecution.id).filter(is_automatic()).label("automatic"),
            func.count(AutomationExecution.id).filter(is_chained()).label("chained"),
            func.count(AutomationExecution.id)
            .filter(is_chained() & is_automatic())
            .label("automatic_chained"),
        )
        .where(AutomationExecution.created_at >= scope.start)
        .group_by(day)
        .order_by(day),
        scope,
    )

    by_flow, by_actor, sources, triggers, trend, failures, active_now = await asyncio.gather(
        _by_flow(scope),
        _by_actor(scope),
        execute_mapping(source_stmt),
        execute_mapping(trigger_stmt),
        execute_mapping(trend_stmt),
        _failures(scope),
        _active_now(scope),
    )
    total = sum(int(row["total"]) for row in trend)
    automatic = sum(int(row["automatic"]) for row in trend)
    chained = sum(int(row["chained"]) for row in trend)
    automatic_chained = sum(int(row["automatic_chained"]) for row in trend)
    return {
        "by_flow": by_flow,
        # Del período entero: `by_flow` trae solo los flujos más usados y
        # sumar sus filas dejaría corto el resumen.
        "origin_totals": {
            "manual": total - automatic,
            "automatic": automatic,
            "manual_chained": chained - automatic_chained,
            "automatic_chained": automatic_chained,
        },
        "by_actor": by_actor,
        "by_source": [
            {"name": SOURCE_LABELS.get(row["name"], str(row["name"])), "value": int(row["value"])}
            for row in sources
        ],
        "by_trigger": items(triggers),
        "trend": series(trend, scope),
        # La misma serie partida en dos; "a mano" es el resto, así suman el total.
        "trend_manual": series(
            [{"day": row["day"], "total": int(row["total"]) - int(row["automatic"])} for row in trend], scope
        ),
        "trend_automatic": series([{"day": row["day"], "total": row["automatic"]} for row in trend], scope),
        "failures": failures,
        "active_now": active_now,
    }

"""Qué flujos se activaron, de qué tipo, quién los disparó y cómo terminaron.

La atribución sale de `automation_executions`: `start_source` distingue el
disparo a mano del vendedor (`manual`, con `started_by_user_id`) del piloto
automático (`system`) y de un flujo que invocó a otro (`flow`).
"""

import asyncio

from sqlalchemy import func, select

from domain_types import AutomationExecutionStatus
from db.models import AutomationExecution, AutomationRule, User

from .context import DashboardScope, execute_mapping, items, local_day, series


ACTIVE_STATUSES = (
    AutomationExecutionStatus.SCHEDULED,
    AutomationExecutionStatus.RUNNING,
    AutomationExecutionStatus.PAUSED,
)

SOURCE_LABELS = {
    "manual": "Iniciado a mano",
    "system": "Piloto automático",
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
            "last_at": row["last_at"].isoformat() if row["last_at"] else None,
        }
        for row in rows
    ]


async def _by_actor(scope: DashboardScope) -> list[dict]:
    """Ranking de quién dispara flujos a mano. Igual que la carga por vendedor,
    se sirve sin acotar al scope: es la comparativa del equipo."""
    actor = func.coalesce(User.name, "Automático")
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
        select(day.label("day"), func.count(AutomationExecution.id).label("total"))
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
    return {
        "by_flow": by_flow,
        "by_actor": by_actor,
        "by_source": [
            {"name": SOURCE_LABELS.get(row["name"], str(row["name"])), "value": int(row["value"])}
            for row in sources
        ],
        "by_trigger": items(triggers),
        "trend": series(trend, scope),
        "failures": failures,
        "active_now": active_now,
    }

"""Distribución del pipeline: etapas, orígenes, servicios, embudo y leads frío
que nadie tocó en días."""

import asyncio
from datetime import timedelta

from sqlalchemy import case, func, select

from db.models import Lead, LeadStage, User

from .context import DashboardScope, execute_mapping, items, local_day, series


# Etapas en las que el lead ya no es trabajo pendiente: no tiene sentido
# contarlas como "sin toque hace N días" ni pedirle un seguimiento.
CLOSED_STAGES = (LeadStage.perdido, LeadStage.descalificado, LeadStage.baja)
# Un lead que llegó acá pasó por "agendado" aunque hoy figure más adelante.
BOOKED_STAGES = (LeadStage.agendado, LeadStage.cliente_activo, LeadStage.postventa)
CUSTOMER_STAGES = (LeadStage.cliente_activo, LeadStage.postventa)

STALE_THRESHOLDS = (3, 7, 15)


def _scoped(stmt, scope: DashboardScope):
    return stmt.where(scope.mine(Lead.vendedor_id))


def _top(label, scope: DashboardScope, limit: int = 8):
    return _scoped(
        select(label.label("name"), func.count(Lead.id).label("value"))
        .group_by(label)
        .order_by(func.count(Lead.id).desc())
        .limit(limit),
        scope,
    )


async def _stages(scope: DashboardScope) -> list[dict]:
    rows = await execute_mapping(
        _scoped(
            select(Lead.estado.label("name"), func.count(Lead.id).label("value")).group_by(Lead.estado),
            scope,
        )
    )
    counts = {stage.value: 0 for stage in LeadStage}
    for row in rows:
        key = row["name"].value if isinstance(row["name"], LeadStage) else str(row["name"])
        counts[key] = int(row["value"])
    return [{"name": stage.value, "value": counts[stage.value]} for stage in LeadStage]


async def _funnel(scope: DashboardScope) -> list[dict]:
    """Conversión de la cohorte creada en el período.

    Los pasos se leen del estado actual del lead, no del historial de
    `lead_activity`: un lead que hoy está en `cliente_activo` cuenta como
    agendado aunque su paso por `agendado` haya sido hace meses. Es una
    aproximación deliberada — reconstruirlo desde la auditoría costaría un
    escaneo del historial completo para una cifra que se lee igual.
    """
    booked = Lead.proxima_cita.is_not(None) | Lead.estado.in_(BOOKED_STAGES)
    rows = await execute_mapping(
        _scoped(
            select(
                func.count(Lead.id).label("created"),
                func.count(Lead.id).filter(Lead.conversacion_abierta_at.is_not(None)).label("engaged"),
                func.count(Lead.id).filter(booked).label("booked"),
                func.count(Lead.id).filter(Lead.estado.in_(CUSTOMER_STAGES)).label("customers"),
                func.count(Lead.id).filter(Lead.estado == LeadStage.perdido).label("lost"),
            ).where(Lead.created_at >= scope.start),
            scope,
        )
    )
    row = rows[0]
    created = int(row["created"] or 0)
    steps = [
        ("Leads nuevos", created),
        ("Conversación iniciada", int(row["engaged"] or 0)),
        ("Agendado", int(row["booked"] or 0)),
        ("Cliente", int(row["customers"] or 0)),
    ]
    return [
        {"name": name, "value": value, "rate": round(value / created * 100, 1) if created else None}
        for name, value in steps
    ] + [{"name": "Perdido", "value": int(row["lost"] or 0), "rate": None}]


async def _pipeline(scope: DashboardScope) -> dict:
    """Cola de trabajo, no resultados: todo este bloque mira solo los leads que
    siguen vivos (`CLOSED_STAGES` queda fuera), así que las conversaciones
    cerradas no incluyen las de un lead que después se marcó perdido."""
    # Un lead recién creado que nadie tocó cuenta desde su creación: sin el
    # COALESCE quedaría fuera del conteo justo cuando más urge contactarlo.
    last_touch = func.coalesce(Lead.fecha_ultimo_toque, Lead.created_at)
    stale_columns = [
        func.count(Lead.id)
        .filter(last_touch < scope.now - timedelta(days=days))
        .label(f"stale_{days}")
        for days in STALE_THRESHOLDS
    ]
    closed_at, opened_at = Lead.conversacion_cerrada_at, Lead.conversacion_abierta_at
    rows = await execute_mapping(
        _scoped(
            select(
                *stale_columns,
                func.count(Lead.id).filter(Lead.conversacion_abierta.is_(True)).label("open"),
                func.count(Lead.id).filter(closed_at >= scope.start).label("closed"),
                func.avg(
                    case(
                        (
                            closed_at >= scope.start,
                            func.extract("epoch", closed_at - opened_at),
                        ),
                    )
                ).label("close_seconds"),
            ).where(Lead.estado.not_in(CLOSED_STAGES)),
            scope,
        )
    )
    row = rows[0]
    close_seconds = row["close_seconds"]
    return {
        "stale": [
            {"name": f"+{days} días", "value": int(row[f"stale_{days}"] or 0)}
            for days in STALE_THRESHOLDS
        ],
        "conversations_open": int(row["open"] or 0),
        "conversations_closed": int(row["closed"] or 0),
        "avg_close_hours": round(float(close_seconds) / 3600, 1) if close_seconds is not None else None,
    }


async def collect(scope: DashboardScope) -> dict:
    origin_label = func.coalesce(Lead.origen, "Sin origen")
    service_label = func.coalesce(Lead.servicio_interes, "Sin servicio")
    seller_label = func.coalesce(User.name, Lead.vendedor, "Sin asignar")
    # El ranking por vendedor nunca se acota al scope: es justamente la
    # comparativa del equipo que el vendedor ve junto a lo suyo.
    seller_stmt = (
        select(seller_label.label("name"), func.count(Lead.id).label("value"))
        .outerjoin(User, User.id == Lead.vendedor_id)
        .group_by(seller_label)
        .order_by(func.count(Lead.id).desc())
        .limit(12)
    )
    day = local_day(Lead.created_at)
    trend_stmt = _scoped(
        select(day.label("day"), func.count(Lead.id).label("total"))
        .where(Lead.created_at >= scope.start)
        .group_by(day)
        .order_by(day),
        scope,
    )

    stages, origins, services, sellers, trend, funnel, pipeline = await asyncio.gather(
        _stages(scope),
        execute_mapping(_top(origin_label, scope)),
        execute_mapping(_top(service_label, scope)),
        execute_mapping(seller_stmt),
        execute_mapping(trend_stmt),
        _funnel(scope),
        _pipeline(scope),
    )
    return {
        "stages": stages,
        "origins": items(origins),
        "services": items(services),
        "sellers": items(sellers),
        "new_leads_trend": series(trend, scope),
        "funnel": funnel,
        "pipeline": pipeline,
    }

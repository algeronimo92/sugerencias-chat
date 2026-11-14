"""Distribución del pipeline: etapas, orígenes, servicios, embudo y leads
fríos que nadie tocó en días."""

import asyncio
from datetime import timedelta

from sqlalchemy import case, func, select

from app.modules.leads.domain.types import LeadStageKind

from app.db.models.auth import User
from app.db.models.leads import Lead, LeadStage

from app.modules.leads.dashboard.scope import DashboardScope, execute_mapping, items, local_day, series


# Las etapas son filas por negocio: el código las clasifica por `kind`, nunca
# por su clave. Una etapa `lost` ya no es trabajo pendiente (no tiene sentido
# contarla como "sin toque hace N días") y una `won` es un cliente.
def _stage_keys(kind: LeadStageKind):
    return select(LeadStage.key).where(LeadStage.kind == kind)


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
    """Todas las etapas del negocio en orden del embudo, con sus leads. Una
    etapa inactiva sin leads no aporta nada al gráfico y se omite."""
    rows = await execute_mapping(
        select(
            LeadStage.key.label("name"),
            LeadStage.is_active,
            func.count(Lead.id).label("value"),
        )
        .outerjoin(Lead, (Lead.estado == LeadStage.key) & scope.mine(Lead.vendedor_id))
        .group_by(LeadStage.key, LeadStage.position, LeadStage.is_active)
        .order_by(LeadStage.position.asc(), LeadStage.key.asc())
    )
    return [
        {"name": row["name"], "value": int(row["value"])}
        for row in rows
        if row["is_active"] or row["value"]
    ]


async def _funnel(scope: DashboardScope) -> list[dict]:
    """Conversión de la cohorte creada en el período.

    Los pasos se leen del estado actual del lead, no del historial de
    `lead_activity`: un lead que hoy está en una etapa `won` cuenta como
    agendado aunque su cita haya sido hace meses. Es una
    aproximación deliberada — reconstruirlo desde la auditoría costaría un
    escaneo del historial completo para una cifra que se lee igual.
    """
    won = Lead.estado.in_(_stage_keys(LeadStageKind.WON))
    booked = Lead.proxima_cita.is_not(None) | won
    rows = await execute_mapping(
        _scoped(
            select(
                func.count(Lead.id).label("created"),
                func.count(Lead.id).filter(Lead.conversacion_abierta_at.is_not(None)).label("engaged"),
                func.count(Lead.id).filter(booked).label("booked"),
                func.count(Lead.id).filter(won).label("customers"),
                func.count(Lead.id).filter(Lead.estado.in_(_stage_keys(LeadStageKind.LOST))).label("lost"),
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
    siguen vivos (las etapas `lost` quedan fuera), así que las conversaciones
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
            ).where(Lead.estado.not_in(_stage_keys(LeadStageKind.LOST))),
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


# --- Exportación a Excel ------------------------------------------------------

async def lead_export_rows(start=None) -> list[dict]:
    """Leads con su estado, uno por fila. Con `start`, solo los que entraron
    desde esa fecha; sin él, todos (el respaldo)."""
    stmt = (
        select(
            Lead.id.label("id"),
            Lead.nombre.label("name"),
            Lead.telefono.label("phone"),
            func.coalesce(LeadStage.name, Lead.estado).label("stage"),
            Lead.servicio_interes.label("service"),
            Lead.origen.label("origin"),
            func.coalesce(User.name, Lead.vendedor).label("seller"),
            Lead.created_at.label("created_at"),
            Lead.ultimo_mensaje_at.label("last_message_at"),
            Lead.razon_perdido.label("lost_reason"),
            Lead.tipo_objecion.label("objection"),
            Lead.contador_noshow.label("no_shows"),
            Lead.toques_seguimiento.label("follow_ups"),
            Lead.notas.label("notes"),
            Lead.custom_fields.label("custom_fields"),
        )
        .outerjoin(LeadStage, LeadStage.key == Lead.estado)
        .outerjoin(User, User.id == Lead.vendedor_id)
        .order_by(Lead.created_at, Lead.id)
    )
    if start is not None:
        stmt = stmt.where(Lead.created_at >= start)
    return [dict(row) for row in await execute_mapping(stmt)]


async def leads_by_user(scope: DashboardScope) -> list[dict]:
    """Por persona del equipo, los leads que entraron en la ventana y cómo
    terminaron hasta hoy. Incluye a quien no tuvo leads, para que su fila
    exista en el reporte, y los leads sin vendedora como una fila aparte."""
    won = func.count(Lead.id).filter(Lead.estado.in_(_stage_keys(LeadStageKind.WON)))
    lost = func.count(Lead.id).filter(Lead.estado.in_(_stage_keys(LeadStageKind.LOST)))
    counts, people = await asyncio.gather(
        execute_mapping(
            select(Lead.vendedor_id.label("user_id"), func.count(Lead.id).label("leads"), won.label("won"), lost.label("lost"))
            .where(Lead.created_at >= scope.start)
            .group_by(Lead.vendedor_id)
        ),
        execute_mapping(
            select(User.id.label("user_id"), User.name.label("name"), User.is_active.label("is_active"))
            .where(User.role.in_(("admin", "vendedor")))
            .order_by(User.name)
        ),
    )
    by_user = {row["user_id"]: row for row in counts}

    def totals(user_id) -> dict:
        found = by_user.get(user_id)
        return {
            "leads": int(found["leads"]) if found else 0,
            "won": int(found["won"]) if found else 0,
            "lost": int(found["lost"]) if found else 0,
        }

    rows = [
        {"user_id": person["user_id"], "name": str(person["name"]), "is_active": bool(person["is_active"]), **totals(person["user_id"])}
        for person in people
    ]
    if None in by_user:
        rows.append({"user_id": None, "name": "Sin asignar", "is_active": True, **totals(None)})
    return rows

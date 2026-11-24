"""Lado de lectura de las automatizaciones: listas y detalle para las
pantallas. La API lo llama directo porque no cambia nada."""

from datetime import date

from sqlalchemy import func, or_, select
from sqlalchemy.orm import aliased

from app.core.time_format import iso_utc
from app.db.models.auth import User
from app.db.models.automations import AutomationExecution, AutomationExecutionMessage, AutomationFlowVersion, AutomationRule
from app.db.models.leads import Lead
from app.db.uow import session_scope
from app.modules.automations.domain.types import AutomationExecutionStatus, AutomationTrigger
from app.modules.automations.domain.limits import ACTIVE_EXECUTION_STATUSES
from app.modules.automations.domain.business_hours_usage import uses_business_hours
from app.modules.automations.domain.delivery import ExecutionDeliveryState
from app.modules.automations.domain.rules import local_day_range_utc


def _rule_dict(row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "trigger_type": row["trigger_type"],
        "trigger_config": row["trigger_config"] or {},
        "conditions": row["conditions"] or {},
        "flow_definition": row["flow_definition"] or {},
        "published_flow_definition": row["published_flow_definition"],
        "flow_version": row["flow_version"] or 0,
        "max_executions_per_hour": row["max_executions_per_hour"],
        "is_active": row["is_active"],
        "visible_to_sellers": bool(row["visible_to_sellers"]),
        "created_by_user_id": row["created_by_user_id"],
        "created_by_name": row["created_by_name"],
        "execution_count": int(row["execution_count"] or 0),
        "last_execution_at": iso_utc(row["last_execution_at"]),
        "last_execution_status": row["last_execution_status"],
        "created_at": iso_utc(row["created_at"]),
        "updated_at": iso_utc(row["updated_at"]),
    }


def _execution_dict(row) -> dict:
    # Una ejecución que arrancó otro flujo guarda a su padre en event_payload
    # (domain/execution.py::child_flow_payload). Se expone para que el chat
    # pueda decir "Hollywood peel › Ubicacion" en vez de solo el nombre hijo.
    payload = row["event_payload"] or {}
    return {
        "id": row["id"],
        "rule_id": row["rule_id"],
        "rule_name": row["rule_name"],
        "rule_deleted": bool(row["rule_deleted"]),
        "parent_execution_id": payload.get("parent_execution_id"),
        "parent_rule_id": payload.get("parent_rule_id"),
        "parent_rule_name": row["parent_rule_name"],
        "lead_id": row["lead_id"],
        "lead_name": row["lead_name"],
        "lead_phone": row["lead_phone"],
        "trigger_type": row["trigger_type"],
        "status": row["status"],
        "scheduled_for": iso_utc(row["scheduled_for"]),
        "paused_at": iso_utc(row["paused_at"]),
        "pause_scope": row["pause_scope"],
        "started_at": iso_utc(row["started_at"]),
        "finished_at": iso_utc(row["finished_at"]),
        "action_results": row["action_results"] or [],
        "flow_state": row["flow_state"] or {},
        "error": row["error"],
        "error_code": row["error_code"],
        "created_at": iso_utc(row["created_at"]),
        "start_source": row["start_source"] or "system",
        "started_by_user_id": row["started_by_user_id"],
        "started_by_name": row["started_by_name"],
        "window_override_at": iso_utc(row["window_override_at"]),
        "attention_dismissed_at": iso_utc(row["attention_dismissed_at"]),
        "delivery_state": row["delivery_state"],
        "window_override_by_name": row["window_override_by_name"],
    }


async def _rules(rule_id: int | None = None) -> list[dict]:
    execution_count = (
        select(func.count(AutomationExecution.id))
        .where(AutomationExecution.rule_id == AutomationRule.id)
        .correlate(AutomationRule)
        .scalar_subquery()
    )
    last_execution_at = (
        select(AutomationExecution.created_at)
        .where(AutomationExecution.rule_id == AutomationRule.id)
        .order_by(AutomationExecution.created_at.desc(), AutomationExecution.id.desc())
        .limit(1)
        .correlate(AutomationRule)
        .scalar_subquery()
    )
    last_execution_status = (
        select(AutomationExecution.status)
        .where(AutomationExecution.rule_id == AutomationRule.id)
        .order_by(AutomationExecution.created_at.desc(), AutomationExecution.id.desc())
        .limit(1)
        .correlate(AutomationRule)
        .scalar_subquery()
    )
    stmt = select(
        AutomationRule.id,
        AutomationRule.name,
        AutomationRule.trigger_type,
        AutomationRule.trigger_config,
        AutomationRule.conditions,
        AutomationRule.flow_definition,
        AutomationRule.published_flow_definition,
        AutomationRule.flow_version,
        AutomationRule.max_executions_per_hour,
        AutomationRule.is_active,
        AutomationRule.visible_to_sellers,
        AutomationRule.created_by_user_id,
        User.name.label("created_by_name"),
        execution_count.label("execution_count"),
        last_execution_at.label("last_execution_at"),
        last_execution_status.label("last_execution_status"),
        AutomationRule.created_at,
        AutomationRule.updated_at,
    ).join(User, User.id == AutomationRule.created_by_user_id).where(
        AutomationRule.deleted_at.is_(None)
    ).order_by(
        AutomationRule.is_active.desc(), AutomationRule.updated_at.desc()
    )
    if rule_id is not None:
        stmt = stmt.where(AutomationRule.id == rule_id)
    async with session_scope() as session:
        rows = (await session.execute(stmt)).mappings().all()
    return [_rule_dict(row) for row in rows]


async def list_automation_rules() -> list[dict]:
    return await _rules()


async def rules_using_business_hours() -> list[dict]:
    """Las automatizaciones que hoy preguntan por el horario de atención, con
    las encendidas primero. Mira la versión que el motor ejecuta: un borrador
    sin publicar todavía no usa nada."""
    stmt = select(
        AutomationRule.id, AutomationRule.name, AutomationRule.is_active,
        AutomationRule.conditions, AutomationRule.published_flow_definition,
    ).where(AutomationRule.deleted_at.is_(None)).order_by(
        AutomationRule.is_active.desc(), AutomationRule.name.asc(),
    )
    async with session_scope() as session:
        rows = (await session.execute(stmt)).mappings().all()
    return [
        {"id": row["id"], "name": row["name"], "is_active": row["is_active"]}
        for row in rows
        if uses_business_hours(row["conditions"], row["published_flow_definition"])
    ]


async def get_automation_rule(rule_id: int) -> dict | None:
    rows = await _rules(rule_id)
    return rows[0] if rows else None


def _filter_executions(
    stmt,
    *,
    rule_id: int | None,
    status: str | None,
    execution_id: int | None,
    exclude_skipped: bool,
    lead_id: str | None,
    start_source: str | None,
    date_from: date | None,
    date_to: date | None,
    active: bool | None,
    started_by_user_id: int | None,
    started_by_anyone: bool,
    owner_id: int | None,
    delivery: str | None = None,
):
    """Los filtros del historial, compartidos por la lista y por su total:
    si cada una armara los suyos, «200 de 1.234» podría contar otra cosa."""
    if owner_id is not None:
        stmt = stmt.where(Lead.vendedor_id == owner_id)
    # Qué pasó con sus mensajes, aparte de si recorrió sus pasos. «ok» incluye
    # las que no mandaron ninguno: tampoco tienen nada sin entregar.
    if delivery == "ok":
        stmt = stmt.where(or_(
            AutomationExecution.delivery_state.is_(None),
            AutomationExecution.delivery_state == ExecutionDeliveryState.DELIVERED,
        ))
    elif delivery:
        stmt = stmt.where(AutomationExecution.delivery_state == delivery)
    if rule_id is not None:
        stmt = stmt.where(AutomationExecution.rule_id == rule_id)
    if status:
        stmt = stmt.where(AutomationExecution.status == status)
    elif exclude_skipped:
        stmt = stmt.where(AutomationExecution.status != AutomationExecutionStatus.SKIPPED)
    elif active is not None:
        # Un status puntual manda sobre este filtro rápido, igual que ya pasa
        # arriba con exclude_skipped.
        stmt = stmt.where(AutomationExecution.status.in_(ACTIVE_EXECUTION_STATUSES) if active
                           else AutomationExecution.status.not_in(ACTIVE_EXECUTION_STATUSES))
    if execution_id is not None:
        stmt = stmt.where(AutomationExecution.id == execution_id)
    if lead_id is not None:
        stmt = stmt.where(AutomationExecution.lead_id == lead_id)
    if start_source is not None:
        stmt = stmt.where(AutomationExecution.start_source == start_source)
    if started_by_user_id is not None:
        stmt = stmt.where(AutomationExecution.started_by_user_id == started_by_user_id)
    elif started_by_anyone:
        # "Todo el equipo" es la unión de los "mis envíos" de cada persona:
        # lo que alguien inició a mano, sin los disparos del sistema.
        stmt = stmt.where(AutomationExecution.started_by_user_id.is_not(None))
    if date_from is not None and date_to is not None:
        range_start, range_end = local_day_range_utc(date_from, date_to)
        stmt = stmt.where(AutomationExecution.created_at >= range_start, AutomationExecution.created_at < range_end)
    return stmt


async def list_automation_executions(
    rule_id: int | None = None,
    status: str | None = None,
    limit: int = 100,
    execution_id: int | None = None,
    exclude_skipped: bool = False,
    lead_id: str | None = None,
    start_source: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    active: bool | None = None,
    started_by_user_id: int | None = None,
    started_by_anyone: bool = False,
    owner_id: int | None = None,
    delivery: str | None = None,
) -> list[dict]:
    # Alias propio: `User` ya está tomado por started_by_user_id y la fila
    # necesita los dos nombres a la vez (quién la arrancó y quién autorizó
    # saltarse la ventana).
    override_user = aliased(User)
    parent_rule = aliased(AutomationRule)
    stmt = select(
        AutomationExecution.id,
        AutomationExecution.rule_id,
        AutomationRule.name.label("rule_name"),
        AutomationRule.deleted_at.is_not(None).label("rule_deleted"),
        AutomationExecution.event_payload,
        parent_rule.name.label("parent_rule_name"),
        AutomationExecution.lead_id,
        Lead.nombre.label("lead_name"),
        Lead.telefono.label("lead_phone"),
        AutomationExecution.trigger_type,
        AutomationExecution.status,
        AutomationExecution.scheduled_for,
        AutomationExecution.paused_at,
        AutomationExecution.pause_scope,
        AutomationExecution.started_at,
        AutomationExecution.finished_at,
        AutomationExecution.action_results,
        AutomationExecution.flow_state,
        AutomationExecution.error,
        AutomationExecution.error_code,
        AutomationExecution.created_at,
        AutomationExecution.start_source,
        AutomationExecution.started_by_user_id,
        User.name.label("started_by_name"),
        AutomationExecution.window_override_at,
        AutomationExecution.attention_dismissed_at,
        AutomationExecution.delivery_state,
        override_user.name.label("window_override_by_name"),
    ).join(AutomationRule, AutomationRule.id == AutomationExecution.rule_id).outerjoin(
        Lead, Lead.id == AutomationExecution.lead_id
    ).outerjoin(
        User, User.id == AutomationExecution.started_by_user_id
    ).outerjoin(
        override_user, override_user.id == AutomationExecution.window_override_by_user_id
    ).outerjoin(
        # El padre viaja como entero dentro del JSON; sin padre el join no
        # aporta fila y el nombre queda en NULL.
        parent_rule, parent_rule.id == AutomationExecution.event_payload["parent_rule_id"].as_integer(),
    )
    stmt = _filter_executions(
        stmt, rule_id=rule_id, status=status, execution_id=execution_id, exclude_skipped=exclude_skipped,
        lead_id=lead_id, start_source=start_source, date_from=date_from, date_to=date_to, active=active,
        started_by_user_id=started_by_user_id, started_by_anyone=started_by_anyone, owner_id=owner_id,
        delivery=delivery,
    )
    stmt = stmt.order_by(AutomationExecution.created_at.desc(), AutomationExecution.id.desc()).limit(limit)
    async with session_scope() as session:
        rows = (await session.execute(stmt)).mappings().all()
    return [_execution_dict(row) for row in rows]


async def count_automation_executions(
    rule_id: int | None = None,
    status: str | None = None,
    exclude_skipped: bool = False,
    lead_id: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    active: bool | None = None,
    started_by_user_id: int | None = None,
    started_by_anyone: bool = False,
    owner_id: int | None = None,
    delivery: str | None = None,
) -> int:
    """Cuántas ejecuciones cumplen los filtros, sin el tope de la lista. El
    historial mostraba «200 resultados» en días de más de 300 y nadie sabía
    que faltaban."""
    # El lead solo hace falta para acotar a los de un vendedor.
    stmt = select(func.count(AutomationExecution.id)).outerjoin(Lead, Lead.id == AutomationExecution.lead_id)
    stmt = _filter_executions(
        stmt, rule_id=rule_id, status=status, execution_id=None, exclude_skipped=exclude_skipped,
        lead_id=lead_id, start_source=None, date_from=date_from, date_to=date_to, active=active,
        started_by_user_id=started_by_user_id, started_by_anyone=started_by_anyone, owner_id=owner_id,
        delivery=delivery,
    )
    async with session_scope() as session:
        return await session.scalar(stmt) or 0


async def execution_message_states(execution_id: int) -> list[dict]:
    """Los mensajes que mandó una ejecución y lo último que se supo de cada
    uno: el detalle detrás de «No se entregó» o «Completada»."""
    async with session_scope() as session:
        rows = (await session.execute(
            select(AutomationExecutionMessage.message_id, AutomationExecutionMessage.state)
            .where(AutomationExecutionMessage.execution_id == execution_id)
            .order_by(AutomationExecutionMessage.message_id.asc())
        )).all()
    return [{"message_id": message_id, "state": state} for message_id, state in rows]


async def get_automation_execution(execution_id: int) -> dict | None:
    rows = await list_automation_executions(execution_id=execution_id, limit=1)
    return rows[0] if rows else None


async def list_manual_flows(is_admin: bool) -> list[dict]:
    """Flujos visuales con trigger manual que puede disparar un vendedor desde
    el chat de un lead. El admin además ve los que todavía no marcó visibles
    (para poder probarlos) o que siguen sin publicar/activar."""
    rules = await list_automation_rules()
    return [
        rule for rule in rules
        if rule["trigger_type"] == AutomationTrigger.MANUAL
        and (is_admin or (rule["visible_to_sellers"] and rule["is_active"]))
    ]


async def list_flow_versions(rule_id: int) -> list[dict]:
    """Versiones publicadas de un flujo visual, de la más nueva a la más vieja."""
    current = await get_automation_rule(rule_id)
    if current is None:
        return []
    stmt = select(
        AutomationFlowVersion.version,
        AutomationFlowVersion.definition,
        AutomationFlowVersion.created_at,
    ).where(AutomationFlowVersion.rule_id == rule_id).order_by(AutomationFlowVersion.version.desc())
    async with session_scope() as session:
        rows = (await session.execute(stmt)).mappings().all()
    return [
        {
            "version": row["version"],
            "created_at": iso_utc(row["created_at"]),
            "node_count": len((row["definition"] or {}).get("nodes") or []),
            "edge_count": len((row["definition"] or {}).get("edges") or []),
            "is_current": row["version"] == current["flow_version"],
        }
        for row in rows
    ]

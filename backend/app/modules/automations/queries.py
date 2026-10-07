"""Lado de lectura de las automatizaciones: listas y detalle para las
pantallas. La API lo llama directo porque no cambia nada."""

from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import aliased

from app.core.time_format import iso_utc
from app.db.models.auth import User
from app.db.models.automations import AutomationExecution, AutomationFlowVersion, AutomationRule
from app.db.models.leads import Lead
from app.db.uow import session_scope
from app.modules.automations.domain.types import AutomationBuilderMode, AutomationExecutionStatus, AutomationTrigger
from app.modules.automations.domain.limits import ACTIVE_EXECUTION_STATUSES
from app.modules.automations.domain.rules import local_day_range_utc


def _rule_dict(row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "trigger_type": row["trigger_type"],
        "trigger_config": row["trigger_config"] or {},
        "conditions": row["conditions"] or {},
        "actions": row["actions"] or [],
        "builder_mode": row["builder_mode"] or AutomationBuilderMode.SIMPLE,
        "flow_definition": row["flow_definition"] or {},
        "published_flow_definition": row["published_flow_definition"],
        "flow_version": row["flow_version"] or 0,
        "delay_minutes": row["delay_minutes"],
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
    return {
        "id": row["id"],
        "rule_id": row["rule_id"],
        "rule_name": row["rule_name"],
        "rule_deleted": bool(row["rule_deleted"]),
        "lead_id": row["lead_id"],
        "lead_name": row["lead_name"],
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
        AutomationRule.actions,
        AutomationRule.builder_mode,
        AutomationRule.flow_definition,
        AutomationRule.published_flow_definition,
        AutomationRule.flow_version,
        AutomationRule.delay_minutes,
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


async def get_automation_rule(rule_id: int) -> dict | None:
    rows = await _rules(rule_id)
    return rows[0] if rows else None


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
) -> list[dict]:
    # Alias propio: `User` ya está tomado por started_by_user_id y la fila
    # necesita los dos nombres a la vez (quién la arrancó y quién autorizó
    # saltarse la ventana).
    override_user = aliased(User)
    stmt = select(
        AutomationExecution.id,
        AutomationExecution.rule_id,
        AutomationRule.name.label("rule_name"),
        AutomationRule.deleted_at.is_not(None).label("rule_deleted"),
        AutomationExecution.lead_id,
        Lead.nombre.label("lead_name"),
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
        override_user.name.label("window_override_by_name"),
    ).join(AutomationRule, AutomationRule.id == AutomationExecution.rule_id).outerjoin(
        Lead, Lead.id == AutomationExecution.lead_id
    ).outerjoin(
        User, User.id == AutomationExecution.started_by_user_id
    ).outerjoin(
        override_user, override_user.id == AutomationExecution.window_override_by_user_id
    )
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
    if date_from is not None and date_to is not None:
        range_start, range_end = local_day_range_utc(date_from, date_to)
        stmt = stmt.where(AutomationExecution.created_at >= range_start, AutomationExecution.created_at < range_end)
    stmt = stmt.order_by(AutomationExecution.created_at.desc(), AutomationExecution.id.desc()).limit(limit)
    async with session_scope() as session:
        rows = (await session.execute(stmt)).mappings().all()
    return [_execution_dict(row) for row in rows]


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
        if rule["builder_mode"] == AutomationBuilderMode.VISUAL
        and rule["trigger_type"] == AutomationTrigger.MANUAL
        and (is_admin or (rule["visible_to_sellers"] and rule["is_active"]))
    ]


async def list_flow_versions(rule_id: int) -> list[dict]:
    """Versiones publicadas de un flujo visual, de la más nueva a la más vieja."""
    current = await get_automation_rule(rule_id)
    if current is None or current["builder_mode"] != AutomationBuilderMode.VISUAL:
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

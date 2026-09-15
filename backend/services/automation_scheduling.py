import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from db.models import AutomationExecution, AutomationRule, Lead
from domain_types import AutomationBuilderMode, AutomationExecutionStatus, AutomationTrigger

logger = logging.getLogger(__name__)

TRIGGER_TYPES = frozenset(AutomationTrigger)


async def schedule_automation_event_in_session(
    session,
    trigger_type: AutomationTrigger,
    lead_id: str,
    event_key: str,
    payload: dict | None = None,
    rule_id: int | None = None,
    started_by_user_id: int | None = None,
    start_source: str = "system",
) -> int:
    if trigger_type not in TRIGGER_TYPES:
        return 0
    stmt = select(
        AutomationRule.id, AutomationRule.delay_minutes, AutomationRule.builder_mode,
        AutomationRule.flow_version,
    ).where(
        AutomationRule.is_active.is_(True), AutomationRule.trigger_type == trigger_type
    )
    if rule_id is not None:
        stmt = stmt.where(AutomationRule.id == rule_id)
    lead = await session.get(Lead, lead_id)
    if lead is None:
        # debug y no warning: el watcher redescubre mensajes de chats sin
        # lead cada ciclo y un warning por chat cada 10s inunda el log.
        logger.debug("Evento de automatización ignorado: lead %s no existe", lead_id)
        return 0
    # La pausa solo corta los triggers de sistema (lead_created,
    # stage_changed, message_received, *_overdue, task_due...). Un flujo
    # manual (start_source == "manual", el vendedor tocó "Iniciar flujo")
    # se respeta igual: lo pidió a propósito.
    if lead.automatizacion_pausada and start_source == "system":
        logger.debug("Evento de automatización ignorado: %s tiene la automatización pausada", lead_id)
        return 0
    rules = (await session.execute(stmt)).mappings().all()
    now = datetime.now(timezone.utc)
    created = 0
    for rule in rules:
        result = await session.execute(
            pg_insert(AutomationExecution).values(
                rule_id=rule["id"],
                lead_id=lead_id,
                trigger_type=trigger_type,
                event_key=event_key,
                event_payload=payload or {},
                status=AutomationExecutionStatus.SCHEDULED,
                scheduled_for=now + timedelta(minutes=rule["delay_minutes"]),
                action_results=[],
                flow_state={
                    "flow_version": rule["flow_version"],
                    "current_node_id": None,
                    "path": [],
                }
                if rule["builder_mode"] == AutomationBuilderMode.VISUAL
                else {},
                created_at=now,
                start_source=start_source,
                started_by_user_id=started_by_user_id,
            ).on_conflict_do_nothing(
                index_elements=[AutomationExecution.rule_id, AutomationExecution.event_key]
            )
        )
        created += result.rowcount
    return created



"""``ExecutionStore`` sobre PostgreSQL.

Cada método usa ``session_scope``: dentro de un caso de uso comparte su
transacción, y el motor (que guarda paso a paso) confirma cada escritura
por separado.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, func, literal, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.db.models.automations import AutomationExecution, AutomationFlowVersion, AutomationRoundRobinState, AutomationRule
from app.db.models.leads import Lead
from app.db.uow import session_scope
from domain_types import AutomationExecutionStatus
from app.modules.automations.domain.execution import Execution, Rule, initial_flow_state
from app.modules.automations.domain.limits import PAUSE_SCOPE_EXECUTION, PAUSE_SCOPE_LEAD
from app.modules.automations.queries import get_automation_execution


def to_rule(row: AutomationRule) -> Rule:
    return Rule(
        id=row.id,
        name=row.name,
        trigger_type=row.trigger_type,
        is_active=row.is_active,
        builder_mode=row.builder_mode,
        conditions=row.conditions or {},
        actions=row.actions or [],
        flow_version=row.flow_version or 0,
        published_flow_definition=row.published_flow_definition,
        max_executions_per_hour=row.max_executions_per_hour,
        created_by_user_id=row.created_by_user_id,
        deleted_at=row.deleted_at,
    )


def to_execution(row: AutomationExecution) -> Execution:
    return Execution(
        id=row.id,
        rule_id=row.rule_id,
        lead_id=row.lead_id,
        trigger_type=row.trigger_type,
        status=row.status,
        event_payload=row.event_payload or {},
        flow_state=row.flow_state or {},
        action_results=row.action_results or [],
        started_by_user_id=row.started_by_user_id,
        window_override_by_user_id=row.window_override_by_user_id,
        start_source=row.start_source or "system",
        error=row.error,
    )


def _resume_values(now: datetime) -> dict:
    """Cómo vuelve a la cola una ejecución congelada: `scheduled_for` corrido
    por lo que duró la pausa, así recupera el tiempo que le faltaba en vez de
    disparar de golpe por haber vencido mientras estaba detenida."""
    return {
        "status": AutomationExecutionStatus.SCHEDULED,
        # El literal va tipado: sin el tipo explícito, `$1 - timestamptz`
        # le deja a Postgres un parámetro sin tipo que resolver contra dos
        # firmas del operador `-`.
        "scheduled_for": AutomationExecution.scheduled_for + (
            literal(now, DateTime(timezone=True))
            - func.coalesce(AutomationExecution.paused_at, now)
        ),
        "paused_at": None,
        "pause_scope": None,
        "error": None,
    }


class SqlExecutionStore:
    async def load(self, execution_id: int) -> tuple[Execution | None, Rule | None]:
        async with session_scope() as session:
            execution = await session.get(AutomationExecution, execution_id)
            rule = await session.get(AutomationRule, execution.rule_id) if execution else None
            return (
                to_execution(execution) if execution else None,
                to_rule(rule) if rule else None,
            )

    async def rule(self, rule_id: int) -> Rule | None:
        async with session_scope() as session:
            rule = await session.get(AutomationRule, rule_id)
            return to_rule(rule) if rule else None

    async def save(self, execution_id: int, **values) -> bool:
        async with session_scope() as session:
            result = await session.execute(update(AutomationExecution).where(
                AutomationExecution.id == execution_id,
                AutomationExecution.status != AutomationExecutionStatus.SKIPPED,
            ).values(**values))
        return bool(result.rowcount)

    async def completed_since(self, rule_id: int, since: datetime) -> int:
        async with session_scope() as session:
            return await session.scalar(
                select(func.count(AutomationExecution.id)).where(
                    AutomationExecution.rule_id == rule_id,
                    AutomationExecution.status == AutomationExecutionStatus.COMPLETED,
                    AutomationExecution.finished_at >= since,
                )
            ) or 0

    async def completed_for_lead_since(self, rule_id: int, lead_id: str, since: datetime) -> bool:
        async with session_scope() as session:
            recent = await session.scalar(
                select(AutomationExecution.id).where(
                    AutomationExecution.rule_id == rule_id,
                    AutomationExecution.lead_id == lead_id,
                    AutomationExecution.status == AutomationExecutionStatus.COMPLETED,
                    AutomationExecution.finished_at >= since,
                ).limit(1)
            )
        return recent is not None

    async def flow_definition(self, rule_id: int, version: int) -> dict | None:
        async with session_scope() as session:
            return await session.scalar(select(AutomationFlowVersion.definition).where(
                AutomationFlowVersion.rule_id == rule_id,
                AutomationFlowVersion.version == version,
            ))

    async def schedule_child(
        self, *, rule: Rule, parent: Execution, event_key: str, payload: dict, now: datetime,
    ) -> int | None:
        async with session_scope() as session:
            child_id = (await session.execute(pg_insert(AutomationExecution).values(
                rule_id=rule.id,
                lead_id=parent.lead_id,
                trigger_type=rule.trigger_type,
                event_key=event_key,
                event_payload=payload,
                status=AutomationExecutionStatus.SCHEDULED,
                scheduled_for=now,
                action_results=[],
                flow_state=initial_flow_state(rule.builder_mode, rule.flow_version),
                created_at=now,
                start_source="flow",
                started_by_user_id=parent.started_by_user_id,
            ).on_conflict_do_nothing(
                index_elements=[AutomationExecution.rule_id, AutomationExecution.event_key]
            ).returning(AutomationExecution.id))).scalar_one_or_none()
            if child_id is None:
                child_id = await session.scalar(select(AutomationExecution.id).where(
                    AutomationExecution.rule_id == rule.id,
                    AutomationExecution.event_key == event_key,
                ))
        return child_id

    async def advance_round_robin(self, rule_id: int, node_id: str, now: datetime) -> int:
        async with session_scope() as session:
            return await session.scalar(pg_insert(AutomationRoundRobinState).values(
                rule_id=rule_id, node_id=node_id, counter=1, updated_at=now,
            ).on_conflict_do_update(
                index_elements=[AutomationRoundRobinState.rule_id, AutomationRoundRobinState.node_id],
                set_={"counter": AutomationRoundRobinState.counter + 1, "updated_at": now},
            ).returning(AutomationRoundRobinState.counter))

    async def round_robin_counter(self, rule_id: int, node_id: str) -> int:
        async with session_scope() as session:
            return await session.scalar(select(AutomationRoundRobinState.counter).where(
                AutomationRoundRobinState.rule_id == rule_id,
                AutomationRoundRobinState.node_id == node_id,
            )) or 0

    async def claim_due(self, now: datetime, limit: int) -> tuple[list[int], list[int]]:
        async with session_scope() as session:
            # Las congeladas van en la misma transacción que el SELECT de
            # abajo, así que ya no se ven como reclamables.
            frozen = (await session.execute(update(AutomationExecution).where(
                AutomationExecution.status == AutomationExecutionStatus.SCHEDULED,
                AutomationExecution.scheduled_for <= now,
                AutomationExecution.start_source != "manual",
                AutomationExecution.lead_id.in_(
                    select(Lead.id).where(Lead.automatizacion_pausada.is_(True))
                ),
            ).values(
                status=AutomationExecutionStatus.PAUSED,
                paused_at=now,
                pause_scope=PAUSE_SCOPE_LEAD,
                error=None,
            ).returning(AutomationExecution.id))).scalars().all()
            ids = (await session.execute(
                select(AutomationExecution.id).where(
                    AutomationExecution.status == AutomationExecutionStatus.SCHEDULED,
                    AutomationExecution.scheduled_for <= now,
                ).order_by(AutomationExecution.scheduled_for.asc()).limit(limit).with_for_update(skip_locked=True)
            )).scalars().all()
            if ids:
                await session.execute(update(AutomationExecution).where(
                    AutomationExecution.id.in_(ids)
                ).values(
                    status=AutomationExecutionStatus.RUNNING,
                    started_at=now,
                    error=None,
                ))
        return list(frozen), list(ids)

    async def find_by_event_key(self, rule_id: int, event_key: str) -> int | None:
        async with session_scope() as session:
            return await session.scalar(select(AutomationExecution.id).where(
                AutomationExecution.rule_id == rule_id,
                AutomationExecution.event_key == event_key,
            ))

    async def view(self, execution_id: int) -> dict | None:
        return await get_automation_execution(execution_id)

    async def requeue(self, execution_id: int, now: datetime, *, override_by_user_id: int | None) -> bool:
        async with session_scope() as session:
            result = await session.execute(update(AutomationExecution).where(
                AutomationExecution.id == execution_id,
                AutomationExecution.status.in_([
                    AutomationExecutionStatus.FAILED, AutomationExecutionStatus.SKIPPED,
                ]),
            ).values(
                status=AutomationExecutionStatus.SCHEDULED,
                scheduled_for=now,
                started_at=None,
                finished_at=None,
                error=None,
                attempts=0,
                window_override_by_user_id=override_by_user_id,
                window_override_at=now if override_by_user_id is not None else None,
            ))
        return bool(result.rowcount)

    async def pause_lead(self, lead_id: str, now: datetime) -> int:
        async with session_scope() as session:
            result = await session.execute(update(AutomationExecution).where(
                AutomationExecution.lead_id == lead_id,
                AutomationExecution.status == AutomationExecutionStatus.SCHEDULED,
                AutomationExecution.start_source != "manual",
            ).values(
                status=AutomationExecutionStatus.PAUSED,
                paused_at=now,
                pause_scope=PAUSE_SCOPE_LEAD,
                error=None,
            ))
        return result.rowcount or 0

    async def resume_lead(self, lead_id: str, now: datetime) -> int:
        # NULL en pause_scope son pausas anteriores a la columna, todas de
        # alcance lead.
        async with session_scope() as session:
            result = await session.execute(update(AutomationExecution).where(
                AutomationExecution.lead_id == lead_id,
                AutomationExecution.status == AutomationExecutionStatus.PAUSED,
                AutomationExecution.pause_scope.is_distinct_from(PAUSE_SCOPE_EXECUTION),
            ).values(**_resume_values(now)))
        return result.rowcount or 0

    async def pause(self, execution_id: int, now: datetime) -> bool:
        async with session_scope() as session:
            result = await session.execute(update(AutomationExecution).where(
                AutomationExecution.id == execution_id,
                AutomationExecution.status == AutomationExecutionStatus.SCHEDULED,
            ).values(
                status=AutomationExecutionStatus.PAUSED,
                paused_at=now,
                pause_scope=PAUSE_SCOPE_EXECUTION,
                error=None,
            ))
        return bool(result.rowcount)

    async def resume(self, execution_id: int, now: datetime) -> bool:
        async with session_scope() as session:
            result = await session.execute(update(AutomationExecution).where(
                AutomationExecution.id == execution_id,
                AutomationExecution.status == AutomationExecutionStatus.PAUSED,
            ).values(**_resume_values(now)))
        return bool(result.rowcount)

    async def cancel(self, execution_id: int, now: datetime) -> bool:
        async with session_scope() as session:
            result = await session.execute(update(AutomationExecution).where(
                AutomationExecution.id == execution_id,
                AutomationExecution.status.in_([
                    AutomationExecutionStatus.SCHEDULED,
                    AutomationExecutionStatus.RUNNING,
                    # Una congelada también se puede descartar: es lo que hace
                    # el vendedor cuando no quiere que ese flujo retome.
                    AutomationExecutionStatus.PAUSED,
                ]),
            ).values(
                status=AutomationExecutionStatus.SKIPPED,
                error="Cancelada manualmente",
                paused_at=None,
                pause_scope=None,
                finished_at=now,
            ))
        return bool(result.rowcount)

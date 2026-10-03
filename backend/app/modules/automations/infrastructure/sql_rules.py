"""``RuleStore`` sobre PostgreSQL."""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime

from sqlalchemy import insert, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.db.models.automations import AutomationExecution, AutomationFlowVersion, AutomationRule
from app.db.uow import session_scope
from domain_types import AutomationExecutionStatus
from app.modules.automations.queries import get_automation_rule

_RULE_FIELDS_WITH_SERVICES = ("conditions", "actions", "flow_definition", "published_flow_definition")


class SqlRuleStore:
    async def get(self, rule_id: int) -> dict | None:
        return await get_automation_rule(rule_id)

    async def insert(self, values: dict, *, user_id: int, now: datetime) -> int:
        async with session_scope() as session:
            return (await session.execute(
                insert(AutomationRule).values(
                    **values,
                    created_by_user_id=user_id,
                    created_at=now,
                    updated_at=now,
                ).returning(AutomationRule.id)
            )).scalar_one()

    async def update(self, rule_id: int, values: dict) -> bool:
        async with session_scope() as session:
            result = await session.execute(
                update(AutomationRule).where(
                    AutomationRule.id == rule_id,
                    AutomationRule.deleted_at.is_(None),
                ).values(**values)
            )
        return bool(result.rowcount)

    async def lock_active_statuses(self, rule_id: int) -> list[str] | None:
        async with session_scope() as session:
            rule = (await session.execute(
                select(AutomationRule.id).where(
                    AutomationRule.id == rule_id,
                    AutomationRule.deleted_at.is_(None),
                ).with_for_update()
            )).scalar_one_or_none()
            if rule is None:
                return None
            return list((await session.execute(select(AutomationExecution.status).where(
                AutomationExecution.rule_id == rule_id,
                AutomationExecution.status.in_([
                    AutomationExecutionStatus.SCHEDULED,
                    AutomationExecutionStatus.RUNNING,
                ]),
            ).with_for_update())).scalars().all())

    async def retire(self, rule_id: int, now: datetime) -> int:
        async with session_scope() as session:
            scheduled = await session.execute(update(AutomationExecution).where(
                AutomationExecution.rule_id == rule_id,
                AutomationExecution.status.in_([
                    AutomationExecutionStatus.SCHEDULED,
                    # También las congeladas por la pausa de un lead: si no, al
                    # reanudar volverían a la cola de una regla que ya no existe.
                    AutomationExecutionStatus.PAUSED,
                ]),
            ).values(
                status=AutomationExecutionStatus.SKIPPED,
                error="La automatización fue eliminada",
                paused_at=None,
                pause_scope=None,
                finished_at=now,
            ))
            await session.execute(update(AutomationRule).where(
                AutomationRule.id == rule_id,
            ).values(is_active=False, deleted_at=now, updated_at=now))
        return scheduled.rowcount or 0

    async def publish(self, rule_id: int, values: dict, *, version: int, now: datetime) -> None:
        async with session_scope() as session:
            await session.execute(update(AutomationRule).where(AutomationRule.id == rule_id).values(
                name=values["name"],
                trigger_type=values["trigger_type"],
                trigger_config=values["trigger_config"],
                conditions=values["conditions"],
                flow_definition=values["flow_definition"],
                published_flow_definition=values["flow_definition"],
                flow_version=version,
                is_active=True,
                updated_at=now,
            ))
            await session.execute(pg_insert(AutomationFlowVersion).values(
                rule_id=rule_id,
                version=version,
                definition=values["flow_definition"],
                created_at=now,
            ).on_conflict_do_nothing(
                index_elements=[AutomationFlowVersion.rule_id, AutomationFlowVersion.version]
            ))

    async def flow_targets(self) -> dict[int, dict]:
        async with session_scope() as session:
            rows = (await session.execute(select(
                AutomationRule.id,
                AutomationRule.name,
                AutomationRule.builder_mode,
                AutomationRule.published_flow_definition,
            ).where(AutomationRule.deleted_at.is_(None)))).mappings().all()
        return {row["id"]: dict(row) for row in rows}

    async def rename_service(self, old_name: str, new_name: str, rename: Callable) -> None:
        """Las reglas referencian servicios por nombre en condiciones, acciones
        y en el flujo publicado: siguen el renombre."""
        columns = [getattr(AutomationRule, name) for name in _RULE_FIELDS_WITH_SERVICES]
        async with session_scope() as session:
            rules = (await session.execute(select(AutomationRule.id, *columns))).mappings().all()
            for rule in rules:
                values = {}
                for name in _RULE_FIELDS_WITH_SERVICES:
                    renamed, changed = rename(rule[name], old_name, new_name)
                    if changed:
                        values[name] = renamed
                if values:
                    await session.execute(update(AutomationRule).where(AutomationRule.id == rule["id"]).values(**values))

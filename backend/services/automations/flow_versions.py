from datetime import datetime, timezone

from sqlalchemy import insert, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from db.models import AutomationFlowVersion, AutomationRule
from db.session import get_sessionmaker
from domain_types import AutomationBuilderMode, AutomationTrigger
from services.automations.common import (
    _ts,
)
from services.automations.flow_validation import (
    normalize_visual_draft,
    validate_visual_flow,
)
from services.automations.rules import (
    get_automation_rule,
    update_automation_rule,
)
from services.automations.scheduler import (
    _backfill_customer_response_deadlines,
)


async def create_visual_flow(name: str, definition: dict, user_id: int) -> dict:
    validated = normalize_visual_draft(name, definition)
    now = datetime.now(timezone.utc)
    async with get_sessionmaker()() as session:
        rule_id = (await session.execute(insert(AutomationRule).values(
            name=validated["name"],
            trigger_type=validated["trigger_type"],
            trigger_config=validated["trigger_config"],
            conditions={}, actions=[], delay_minutes=0, is_active=False,
            builder_mode=AutomationBuilderMode.VISUAL,
            flow_definition=validated["flow_definition"],
            published_flow_definition=None, flow_version=0,
            created_by_user_id=user_id, created_at=now, updated_at=now,
        ).returning(AutomationRule.id))).scalar_one()
        await session.commit()
    return await get_automation_rule(rule_id)


async def save_visual_flow(rule_id: int, name: str, definition: dict) -> dict | None:
    current = await get_automation_rule(rule_id)
    if current is None or current["builder_mode"] != AutomationBuilderMode.VISUAL:
        return None
    validated = normalize_visual_draft(name, definition)
    return await update_automation_rule(rule_id, {
        "name": validated["name"],
        "flow_definition": validated["flow_definition"],
    })


async def publish_visual_flow(rule_id: int) -> dict | None:
    current = await get_automation_rule(rule_id)
    if current is None or current["builder_mode"] != AutomationBuilderMode.VISUAL:
        return None
    validated = await validate_visual_flow(
        current["name"], current["flow_definition"], current_rule_id=rule_id,
    )
    if validated["flow_definition"] == current["published_flow_definition"]:
        raise ValueError("No hay cambios pendientes para publicar")
    now = datetime.now(timezone.utc)
    new_version = current["flow_version"] + 1
    async with get_sessionmaker()() as session:
        await session.execute(update(AutomationRule).where(AutomationRule.id == rule_id).values(
            name=validated["name"],
            trigger_type=validated["trigger_type"],
            trigger_config=validated["trigger_config"],
            conditions=validated["conditions"],
            flow_definition=validated["flow_definition"],
            published_flow_definition=validated["flow_definition"],
            flow_version=new_version,
            is_active=True,
            updated_at=now,
        ))
        await session.execute(pg_insert(AutomationFlowVersion).values(
            rule_id=rule_id,
            version=new_version,
            definition=validated["flow_definition"],
            created_at=now,
        ).on_conflict_do_nothing(
            index_elements=[AutomationFlowVersion.rule_id, AutomationFlowVersion.version]
        ))
        await session.commit()
    item = await get_automation_rule(rule_id)
    if item and item["trigger_type"] == AutomationTrigger.CUSTOMER_RESPONSE_OVERDUE:
        await _backfill_customer_response_deadlines(rule_id)
    return item


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
    async with get_sessionmaker()() as session:
        rows = (await session.execute(stmt)).mappings().all()
    return [
        {
            "version": row["version"],
            "created_at": _ts(row["created_at"]),
            "node_count": len((row["definition"] or {}).get("nodes") or []),
            "edge_count": len((row["definition"] or {}).get("edges") or []),
            "is_current": row["version"] == current["flow_version"],
        }
        for row in rows
    ]


async def restore_flow_version(rule_id: int, version: int) -> dict | None:
    """Carga una versión publicada como borrador.

    No republica ni reactiva: deja el flujo listo para revisar y, si convence,
    publicar. Así restaurar nunca cambia por sí solo lo que se está ejecutando.
    """
    current = await get_automation_rule(rule_id)
    if current is None or current["builder_mode"] != AutomationBuilderMode.VISUAL:
        return None
    async with get_sessionmaker()() as session:
        definition = await session.scalar(select(AutomationFlowVersion.definition).where(
            AutomationFlowVersion.rule_id == rule_id,
            AutomationFlowVersion.version == version,
        ))
    if not definition:
        return None
    validated = normalize_visual_draft(current["name"], definition)
    return await update_automation_rule(rule_id, {"flow_definition": validated["flow_definition"]})

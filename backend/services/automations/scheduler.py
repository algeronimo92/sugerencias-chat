from datetime import datetime, timedelta, timezone

from sqlalchemy import and_, func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from db.models import AutomationExecution, AutomationRule, Lead, LeadActivity, WspMessage
from db.session import get_sessionmaker
from domain_types import AutomationBuilderMode, AutomationExecutionStatus, AutomationTrigger
from services.automation_scheduling import schedule_automation_event_in_session
from services.automations.common import (
    OVERDUE_LOOKBACK_GRACE_MINUTES,
    _wake,
)
from services.db_service import open_conversation_from_inbound
from services.ws_manager import manager
from services.time_format import iso_utc


async def schedule_automation_event(
    trigger_type: AutomationTrigger,
    lead_id: str,
    event_key: str,
    payload: dict | None = None,
    rule_id: int | None = None,
    started_by_user_id: int | None = None,
    start_source: str = "system",
) -> int:
    async with get_sessionmaker()() as session:
        created = await schedule_automation_event_in_session(
            session, trigger_type, lead_id, event_key, payload,
            rule_id=rule_id, started_by_user_id=started_by_user_id, start_source=start_source,
        )
        await session.commit()
    await notify_automations_scheduled(created)
    return created


async def notify_automations_scheduled(created: int) -> None:
    if created:
        await manager.broadcast({"type": "automations_updated"})
        _wake.set()


async def trigger_lead_created(lead_id: str) -> None:
    async with get_sessionmaker()() as session:
        activity_id = await session.scalar(
            select(LeadActivity.id).where(
                LeadActivity.lead_id == lead_id,
                LeadActivity.event_type == AutomationTrigger.LEAD_CREATED,
            ).order_by(LeadActivity.id.desc()).limit(1)
        )
    await schedule_automation_event(
        AutomationTrigger.LEAD_CREATED,
        lead_id,
        f"lead:{activity_id or lead_id}",
    )
    _wake.set()


def _message_sent_at(value) -> datetime:
    """Normaliza el timestamp que llega desde el webhook o el watcher.

    Los mensajes consultados desde la base ya incluyen ``sent_at``. El fallback
    conserva compatibilidad con productores antiguos durante un despliegue
    gradual, aunque los eventos nuevos siempre deberían traerlo.
    """
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, str) and value.strip():
        try:
            parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        except ValueError:
            parsed = datetime.now(timezone.utc)
    else:
        parsed = datetime.now(timezone.utc)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


async def _cancel_customer_response_deadlines(lead_id: str) -> int:
    """Invalida el cierre pendiente cuando el cliente vuelve a responder."""
    now = datetime.now(timezone.utc)
    async with get_sessionmaker()() as session:
        result = await session.execute(update(AutomationExecution).where(
            AutomationExecution.lead_id == lead_id,
            AutomationExecution.trigger_type == AutomationTrigger.CUSTOMER_RESPONSE_OVERDUE,
            AutomationExecution.status == AutomationExecutionStatus.SCHEDULED,
            AutomationExecution.started_at.is_(None),
        ).values(
            status=AutomationExecutionStatus.SKIPPED,
            error="El cliente respondió antes del vencimiento",
            finished_at=now,
        ))
        await session.commit()
    return result.rowcount or 0


async def _schedule_customer_response_deadlines(
    message: dict,
    rule_id: int | None = None,
) -> int:
    """Crea o mueve el vencimiento de cada regla sin recorrer otros chats.

    La clave se ancla al último mensaje del cliente. Así varios mensajes del
    vendedor mueven el mismo temporizador y un mensaje enviado por la propia
    automatización no genera un ciclo infinito de nuevos follow-ups.
    """
    lead_id = message.get("chat_id")
    message_key = str(message.get("message_id") or "")
    if not lead_id or not message_key or message.get("sender") != "vendedor":
        return 0

    rule_stmt = select(
        AutomationRule.id,
        AutomationRule.trigger_config,
        AutomationRule.delay_minutes,
        AutomationRule.builder_mode,
        AutomationRule.flow_version,
    ).where(
        AutomationRule.is_active.is_(True),
        AutomationRule.trigger_type == AutomationTrigger.CUSTOMER_RESPONSE_OVERDUE,
    )
    if rule_id is not None:
        rule_stmt = rule_stmt.where(AutomationRule.id == rule_id)

    now = datetime.now(timezone.utc)
    sent_at = _message_sent_at(message.get("sent_at"))
    async with get_sessionmaker()() as session:
        lead = await session.get(Lead, lead_id)
        if lead is None or lead.automatizacion_pausada:
            return 0
        rules = (await session.execute(rule_stmt)).mappings().all()
        if not rules:
            return 0
        customer_anchor = await session.scalar(select(WspMessage.id).where(
            WspMessage.chat_id == lead_id,
            WspMessage.sender == "cliente",
        ).order_by(WspMessage.sent_at.desc(), WspMessage.id.desc()).limit(1))
        event_key = (
            f"silence:{customer_anchor}"
            if customer_anchor is not None
            else f"silence:none:{lead_id}"
        )
        changed = 0
        for rule in rules:
            minutes = max(1, int((rule["trigger_config"] or {}).get("minutes", 1)))
            scheduled_for = sent_at + timedelta(
                minutes=minutes + int(rule["delay_minutes"] or 0)
            )
            payload = {
                "last_message_id": message_key,
                "last_sender": "vendedor",
                "last_message_at": iso_utc(sent_at),
                "deadline_at": iso_utc(scheduled_for),
            }
            flow_state = (
                {
                    "flow_version": rule["flow_version"],
                    "current_node_id": None,
                    "path": [],
                }
                if rule["builder_mode"] == AutomationBuilderMode.VISUAL
                else {}
            )
            result = await session.execute(
                pg_insert(AutomationExecution).values(
                    rule_id=rule["id"],
                    lead_id=lead_id,
                    trigger_type=AutomationTrigger.CUSTOMER_RESPONSE_OVERDUE,
                    event_key=event_key,
                    event_payload=payload,
                    status=AutomationExecutionStatus.SCHEDULED,
                    scheduled_for=scheduled_for,
                    action_results=[],
                    flow_state=flow_state,
                    created_at=now,
                    start_source="system",
                ).on_conflict_do_update(
                    index_elements=[AutomationExecution.rule_id, AutomationExecution.event_key],
                    set_={
                        "event_payload": payload,
                        "scheduled_for": scheduled_for,
                        "flow_state": flow_state,
                        "error": None,
                        "finished_at": None,
                    },
                    where=and_(
                        AutomationExecution.status == AutomationExecutionStatus.SCHEDULED,
                        AutomationExecution.started_at.is_(None),
                    ),
                )
            )
            changed += result.rowcount or 0
        await session.commit()
    if changed:
        _wake.set()
        await manager.broadcast({"type": "automations_updated"})
    return changed


async def trigger_inbound_message(message: dict) -> None:
    sender = message.get("sender")
    if sender not in {"cliente", "vendedor"} or not message.get("chat_id"):
        return
    lead_id = message["chat_id"]
    message_key = str(message.get("message_id") or "")
    if not message_key:
        return
    if sender == "vendedor":
        await _schedule_customer_response_deadlines(message)
        return
    cancelled = await _cancel_customer_response_deadlines(lead_id)
    if cancelled:
        await manager.broadcast({"type": "automations_updated"})
    conversation = await open_conversation_from_inbound(lead_id, message_key, message.get("content"))
    if conversation is not None:
        await schedule_automation_event(
            AutomationTrigger.CONVERSATION_STARTED,
            lead_id,
            f"conversation:{lead_id}:{conversation['version']}",
            {
                "message_id": message_key,
                "content": message.get("content"),
                "conversation_version": conversation["version"],
                "conversation_opened_at": conversation["opened_at"],
            },
        )
    await schedule_automation_event(
        AutomationTrigger.MESSAGE_RECEIVED,
        lead_id,
        f"message:{message_key}",
        {"message_id": message_key, "content": message.get("content")},
    )
    async with get_sessionmaker()() as session:
        message_count = await session.scalar(
            select(func.count(WspMessage.id)).where(WspMessage.chat_id == lead_id)
        )
        has_recorded_creation = await session.scalar(
            select(LeadActivity.id).where(
                LeadActivity.lead_id == lead_id,
                LeadActivity.event_type == AutomationTrigger.LEAD_CREATED,
            ).limit(1)
        )
    if message_count == 1 and not has_recorded_creation:
        await schedule_automation_event(
            AutomationTrigger.LEAD_CREATED,
            lead_id,
            f"lead:first-message:{message_key}",
            {"source": "first_inbound_message"},
        )
    _wake.set()


async def _backfill_customer_response_deadlines(rule_id: int) -> int:
    """Programa una sola vez los chats recientes al activar/publicar una regla.

    Esto evita perder conversaciones ya abiertas durante un deploy sin volver
    al barrido periódico. La ventana limitada conserva la protección previa
    contra envíos masivos a historiales antiguos.
    """
    async with get_sessionmaker()() as session:
        rule = (await session.execute(select(
            AutomationRule.id,
            AutomationRule.trigger_config,
        ).where(
            AutomationRule.id == rule_id,
            AutomationRule.is_active.is_(True),
            AutomationRule.trigger_type == AutomationTrigger.CUSTOMER_RESPONSE_OVERDUE,
        ))).mappings().first()
        if rule is None:
            return 0
        minutes = max(1, int((rule["trigger_config"] or {}).get("minutes", 1)))
        lookback = datetime.now(timezone.utc) - timedelta(
            minutes=minutes + OVERDUE_LOOKBACK_GRACE_MINUTES
        )
        last_message = select(
            WspMessage.id,
            WspMessage.wa_message_id,
            WspMessage.chat_id,
            WspMessage.sender,
            WspMessage.sent_at,
        ).where(WspMessage.sent_at >= lookback).order_by(
            WspMessage.chat_id,
            WspMessage.sent_at.desc(),
            WspMessage.id.desc(),
        ).distinct(WspMessage.chat_id).subquery()
        rows = (await session.execute(select(last_message).join(
            Lead, Lead.id == last_message.c.chat_id
        ).where(
            last_message.c.sender == "vendedor",
            Lead.automatizacion_pausada.is_(False),
        ).limit(500))).mappings().all()
    scheduled = 0
    for row in rows:
        scheduled += await _schedule_customer_response_deadlines({
            "chat_id": row["chat_id"],
            "message_id": str(row["wa_message_id"] or row["id"]),
            "sender": "vendedor",
            "sent_at": row["sent_at"],
        }, rule_id=rule_id)
    return scheduled

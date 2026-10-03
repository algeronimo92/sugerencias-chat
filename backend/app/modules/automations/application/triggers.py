"""Disparadores: qué ejecuciones se agendan cuando pasa algo en el negocio.

Lo llaman los suscriptores (un lead nuevo, un mensaje) y los barridos del
worker. Cada alta corre en su unidad de trabajo y avisa con un evento, que
despierta al worker y refresca los paneles después del commit.
"""

from __future__ import annotations

from datetime import datetime, timezone

from domain_types import AutomationTrigger

from app.core.events import publish
from app.db.uow import collect, unit_of_work
from app.modules.automations.application.ports import automation_ports
from app.modules.automations.domain.events import AutomationsChanged, AutomationsScheduled
from app.modules.leads.public import open_conversation_from_inbound


async def schedule_automation_event(
    trigger_type: AutomationTrigger,
    lead_id: str,
    event_key: str,
    payload: dict | None = None,
    rule_id: int | None = None,
    started_by_user_id: int | None = None,
    start_source: str = "system",
) -> int:
    async with unit_of_work():
        created = await automation_ports().scheduling.schedule(
            trigger_type, lead_id, event_key, payload,
            rule_id=rule_id, started_by_user_id=started_by_user_id, start_source=start_source,
        )
        if created:
            collect(AutomationsScheduled(count=created))
    return created


async def trigger_lead_created(lead_id: str) -> None:
    activity_id = await automation_ports().scheduling.lead_created_activity(lead_id)
    await schedule_automation_event(
        AutomationTrigger.LEAD_CREATED,
        lead_id,
        f"lead:{activity_id or lead_id}",
    )


async def schedule_customer_response_deadlines(message: dict, rule_id: int | None = None) -> int:
    """Crea o mueve el vencimiento de cada regla de silencio del cliente para
    el chat de ``message`` (un mensaje del vendedor)."""
    changed = await automation_ports().scheduling.schedule_customer_deadlines(message, rule_id=rule_id)
    if changed:
        await publish(AutomationsChanged(wake=True))
    return changed


async def backfill_customer_response_deadlines(rule_id: int) -> int:
    """Programa una sola vez los chats recientes al activar/publicar una regla.

    Esto evita perder conversaciones ya abiertas durante un deploy sin volver
    al barrido periódico. La ventana limitada conserva la protección previa
    contra envíos masivos a historiales antiguos.
    """
    scheduled = 0
    for row in await automation_ports().scheduling.recent_seller_silences(rule_id):
        scheduled += await schedule_customer_response_deadlines({
            "chat_id": row["chat_id"],
            "message_id": str(row["wa_message_id"] or row["id"]),
            "sender": "vendedor",
            "sent_at": row["sent_at"],
        }, rule_id=rule_id)
    return scheduled


async def trigger_inbound_message(message: dict) -> None:
    sender = message.get("sender")
    if sender not in {"cliente", "vendedor"} or not message.get("chat_id"):
        return
    lead_id = message["chat_id"]
    message_key = str(message.get("message_id") or "")
    if not message_key:
        return
    if sender == "vendedor":
        await schedule_customer_response_deadlines(message)
        return
    scheduling = automation_ports().scheduling
    if await scheduling.cancel_customer_deadlines(lead_id, datetime.now(timezone.utc)):
        await publish(AutomationsChanged())
    # El contexto del mensaje viaja con el evento: las condiciones del flujo
    # pueden mirar su tipo literal y el id que eligió el cliente.
    message_context = {
        "message_id": message_key,
        "content": message.get("content"),
        "message_type": message.get("message_type"),
        "message_subtype": message.get("message_subtype"),
        "reply_id": message.get("reply_id"),
    }
    conversation = await open_conversation_from_inbound(lead_id, message_key, message.get("content"))
    if conversation is not None:
        await schedule_automation_event(
            AutomationTrigger.CONVERSATION_STARTED,
            lead_id,
            f"conversation:{lead_id}:{conversation['version']}",
            {
                **message_context,
                "conversation_version": conversation["version"],
                "conversation_opened_at": conversation["opened_at"],
            },
        )
    await schedule_automation_event(
        AutomationTrigger.MESSAGE_RECEIVED,
        lead_id,
        f"message:{message_key}",
        message_context,
    )
    if await scheduling.is_first_message(lead_id):
        await schedule_automation_event(
            AutomationTrigger.LEAD_CREATED,
            lead_id,
            f"lead:first-message:{message_key}",
            {"source": "first_inbound_message"},
        )

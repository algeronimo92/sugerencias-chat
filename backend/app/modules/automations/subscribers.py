"""Lo que el motor de automatizaciones hace cuando pasa algo, y cómo avisa
lo que hizo.

``leads`` no conoce a este módulo: publica sus eventos y acá se decide qué
flujos agendar. El agendado corre dentro de la transacción del cambio, así que
un lead nunca queda movido sin sus ejecuciones (ni al revés). Un error al
agendar se registra y no revierte el cambio de etapa: se aísla en un
savepoint.

Al revés, el motor publica sus propios eventos y los avisos (WebSocket,
notificaciones, despertar al worker) salen de acá, después del commit.
"""

from __future__ import annotations

import logging

from sqlalchemy.exc import SQLAlchemyError

from app.core.events import Phase, subscribe
from app.db.uow import collect, current_session
from app.modules.automations.application.management import pause_lead_executions, resume_lead_executions
from app.modules.automations.application.ports import automation_ports
from app.modules.automations.application.triggers import trigger_inbound_message
from app.modules.automations.domain.events import (
    AutomationMessagesQueued,
    AutomationNotificationCreated,
    AutomationsChanged,
    AutomationsScheduled,
    AutomationTaskCreated,
    ExecutionFailed,
)
from app.modules.automations.infrastructure import wakeup
from app.modules.catalogs.public import ServiceRenamed, rename_service_references
from app.modules.conversations.ports.message_queries import fetch_message_by_wa_id
from app.modules.conversations.ports.service_window import SERVICE_WINDOW_CLOSED_ERROR, SERVICE_WINDOW_ERROR_CODE
from app.modules.conversations.public import ExternalMessageDetected, ProviderMessageStored
from app.modules.leads.public import LeadCreated, LeadStageChanged, LeadUpdated
from app.modules.notifications.ports.push_service import send_push_to_user
from app.modules.notifications.ports.service import create_system_notification
from app.realtime.ws_manager import manager
from app.modules.automations.domain.types import AutomationTrigger
from app.modules.notifications.ports.types import NotificationType

logger = logging.getLogger(__name__)


# --- Agendar a partir de los eventos del negocio ----------------------------

async def _schedule(trigger: AutomationTrigger, lead_id: str, event_key: str, payload: dict | None = None) -> None:
    try:
        async with current_session().begin_nested():
            created = await automation_ports().scheduling.schedule(trigger, lead_id, event_key, payload)
    except SQLAlchemyError:
        logger.exception("No se pudieron agendar las automatizaciones %s de %s", trigger, lead_id)
        return
    if created:
        collect(AutomationsScheduled(count=created))


@subscribe(LeadStageChanged, phase=Phase.TRANSACTION)
async def schedule_stage_changed(event: LeadStageChanged) -> None:
    if not event.triggers_automations:
        return
    await _schedule(
        AutomationTrigger.STAGE_CHANGED,
        event.lead_id,
        f"stage:{event.activity_id}",
        {"old_value": {"stage": event.old_stage}, "new_value": {"stage": event.new_stage}},
    )


@subscribe(LeadCreated, phase=Phase.TRANSACTION)
async def schedule_lead_created(event: LeadCreated) -> None:
    await _schedule(AutomationTrigger.LEAD_CREATED, event.lead_id, f"lead:{event.activity_id}")


@subscribe(ServiceRenamed, phase=Phase.TRANSACTION)
async def follow_service_rename(event: ServiceRenamed) -> None:
    """Las reglas referencian servicios por nombre en condiciones, acciones y
    en el flujo publicado: siguen el renombre en la misma transacción."""
    await automation_ports().rules.rename_service(event.old_name, event.new_name, rename_service_references)


@subscribe(LeadUpdated, phase=Phase.AFTER_COMMIT)
async def follow_lead_pause(event: LeadUpdated) -> None:
    """La pausa congela y la reanudación descongela: lo que quedó a medias
    sigue después por donde iba, con el tiempo que le faltaba."""
    if "automatizacion_pausada" not in event.values:
        return
    if event.values["automatizacion_pausada"]:
        await pause_lead_executions(event.lead_id)
    else:
        await resume_lead_executions(event.lead_id)


@subscribe(ProviderMessageStored, phase=Phase.AFTER_COMMIT)
async def follow_provider_message(event: ProviderMessageStored) -> None:
    """Un mensaje nuevo (del cliente o eco del vendedor) puede abrir una
    conversación, cumplir una espera o vencer un plazo. Los avisos de sistema
    de Meta no son algo que dijo una persona."""
    if not event.conversational:
        return
    message = await fetch_message_by_wa_id(event.wa_message_id)
    if message is not None:
        await trigger_inbound_message(message)


@subscribe(ExternalMessageDetected, phase=Phase.AFTER_COMMIT)
async def follow_external_message(event: ExternalMessageDetected) -> None:
    await trigger_inbound_message(event.message)


# --- Avisos de lo que hizo el motor ------------------------------------------

@subscribe(AutomationsChanged, phase=Phase.AFTER_COMMIT)
async def announce_automations_changed(event: AutomationsChanged) -> None:
    await manager.broadcast({"type": "automations_updated"})
    if event.wake:
        wakeup.wake()


@subscribe(AutomationMessagesQueued, phase=Phase.AFTER_COMMIT)
async def announce_messages_queued(event: AutomationMessagesQueued) -> None:
    await manager.broadcast({"type": "chats_updated", "chat_id": event.chat_id, "reason": "outbound_message"})


@subscribe(AutomationTaskCreated, phase=Phase.AFTER_COMMIT)
async def announce_task_created(event: AutomationTaskCreated) -> None:
    await manager.broadcast({"type": "tasks_updated"})


@subscribe(AutomationNotificationCreated, phase=Phase.AFTER_COMMIT)
async def deliver_notification(event: AutomationNotificationCreated) -> None:
    await manager.send_to_user(event.user_id, {"type": "notification_created", "notification": event.notification})


@subscribe(ExecutionFailed, phase=Phase.AFTER_COMMIT)
async def notify_execution_failure(event: ExecutionFailed) -> None:
    """Avisa al admin que creó la regla cuando una ejecución queda en failed —
    sin esto los fallos solo se descubren entrando al historial a mirar."""
    is_service_window_error = event.error == SERVICE_WINDOW_CLOSED_ERROR
    title = f"Automatización con error: {event.rule_name}"[:160]
    body = (event.error or "La ejecución falló")[:1000]
    try:
        notification = await create_system_notification(
            event.rule_owner_id,
            # Ventana de 24 h cerrada es su propio evento, no un AUTOMATION
            # genérico: así el frontend lo distingue por notification_type y
            # no por leer la metadata.
            NotificationType.SERVICE_WINDOW_CLOSED if is_service_window_error else NotificationType.AUTOMATION,
            title,
            body,
            event.lead_id,
            f"execution-failed:{event.execution_id}",
            {
                "automation_rule_id": event.rule_id,
                "automation_execution_id": event.execution_id,
                # Se conserva por compatibilidad con notificaciones ya creadas
                # antes de que este caso tuviera su propio notification_type.
                **({"error_code": SERVICE_WINDOW_ERROR_CODE} if is_service_window_error else {}),
            },
        )
        await manager.send_to_user(event.rule_owner_id, {"type": "notification_created", "notification": notification})
        # Va al lead si la ejecución tiene uno, y si no a la pantalla de
        # automatizaciones: si el admin no tenía el CRM abierto, se entera
        # igual.
        await send_push_to_user(
            event.rule_owner_id,
            title,
            body,
            f"/chat/{event.lead_id}" if event.lead_id else "/automations",
            tag=f"execution-failed-{event.execution_id}",
        )
    except Exception:
        logger.exception("No se pudo notificar el fallo de la ejecución %s", event.execution_id)

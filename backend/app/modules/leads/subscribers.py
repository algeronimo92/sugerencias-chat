"""Reacciones de ``leads`` a eventos propios y ajenos.

- Avisos de tiempo real (después del commit): un panel nunca se entera de un
  cambio que la transacción terminó revirtiendo. Reemplazan los
  ``manager.broadcast`` que cada llamador emitía por su cuenta.
- Cambios que otros módulos provocan sobre los leads (en la transacción),
  como seguir el renombre de un servicio del catálogo.
"""

from __future__ import annotations

import logging

from app.core.events import Phase, subscribe
from app.modules.catalogs.public import USAGE_ITEMS, ServiceDeletionRequested, ServiceRenamed, describe_usage
from app.modules.conversations.public import InternalNoteWritten
from app.modules.leads.attribution.commands import queue_appointment_conversions
from app.modules.leads.application.commands import record_note_activity, rename_service
from app.modules.leads.domain.events import (
    LeadAppointmentScheduled,
    LeadChangedOutside,
    LeadCreated,
    LeadDeleted,
    LeadNoShowRegistered,
    LeadStageChanged,
    LeadStagesChanged,
    LeadTagged,
    LeadUpdated,
    LeadsMerged,
)
from app.modules.leads.domain.lead import BOOKKEEPING_FIELDS, Actor
from app.modules.leads.queries import service_usage
from app.modules.leads.visibility import lead_audience
from app.realtime.ws_manager import manager

logger = logging.getLogger(__name__)


@subscribe(LeadCreated, phase=Phase.AFTER_COMMIT)
async def lead_created(event: LeadCreated) -> None:
    await manager.broadcast({"type": "chats_updated", "chat_id": event.lead_id, "reason": "lead_created"}, sellers=await lead_audience(event.lead_id))


@subscribe(LeadStageChanged, phase=Phase.AFTER_COMMIT)
async def stage_changed(event: LeadStageChanged) -> None:
    await manager.broadcast({"type": "chats_updated", "chat_id": event.lead_id, "reason": "stage_changed"}, sellers=await lead_audience(event.lead_id))


@subscribe(LeadUpdated, phase=Phase.AFTER_COMMIT)
async def lead_updated(event: LeadUpdated) -> None:
    # Las marcas que el sistema mueve en cada mensaje no son una edición:
    # el mensaje ya avisa por su lado.
    if set(event.fields) <= BOOKKEEPING_FIELDS:
        return
    if "vendedor_id" in event.fields and await lead_audience(event.lead_id) is not None:
        # El vendedor anterior también debe vaciar su caché, sin recibir el lead.
        await manager.broadcast({"type": "lead_visibility_changed"})
        return
    reason = "lead_updated"
    if event.event_type == "conversation_opened":
        reason = "conversation_opened"
    elif event.event_type == "conversation_closed":
        reason = "conversation_closed"
    await manager.broadcast({"type": "chats_updated", "chat_id": event.lead_id, "reason": reason}, sellers=await lead_audience(event.lead_id))


@subscribe(LeadNoShowRegistered, phase=Phase.AFTER_COMMIT)
async def no_show_registered(event: LeadNoShowRegistered) -> None:
    await manager.broadcast({"type": "chats_updated", "chat_id": event.lead_id, "reason": "lead_updated"}, sellers=await lead_audience(event.lead_id))


@subscribe(LeadTagged, phase=Phase.AFTER_COMMIT)
async def tag_changed(event: LeadTagged) -> None:
    await manager.broadcast({"type": "chats_updated", "chat_id": event.lead_id, "reason": "tag_changed"}, sellers=await lead_audience(event.lead_id))


@subscribe(LeadDeleted, phase=Phase.AFTER_COMMIT)
async def lead_deleted(event: LeadDeleted) -> None:
    if await lead_audience(event.lead_id) is None:
        await manager.broadcast({"type": "chats_updated", "chat_id": event.lead_id, "reason": "lead_deleted"})
    else:
        await manager.broadcast({"type": "lead_visibility_changed"})


@subscribe(LeadsMerged, phase=Phase.AFTER_COMMIT)
async def leads_merged(event: LeadsMerged) -> None:
    await manager.broadcast({"type": "chats_updated", "chat_id": event.lead_id, "reason": "lead_updated"}, sellers=await lead_audience(event.lead_id))
    if await lead_audience(event.source_id) is None:
        await manager.broadcast({"type": "chats_updated", "chat_id": event.source_id, "reason": "lead_deleted"})
    else:
        await manager.broadcast({"type": "lead_visibility_changed"})


@subscribe(ServiceRenamed, phase=Phase.TRANSACTION)
async def follow_service_rename(event: ServiceRenamed) -> None:
    await rename_service(
        event.old_name, event.new_name,
        actor=Actor.of(event.actor_user_id), service_id=event.service_id,
    )


@subscribe(ServiceDeletionRequested, phase=Phase.TRANSACTION)
async def report_service_usage(event: ServiceDeletionRequested) -> None:
    usage = await service_usage(event.service_id, event.name, USAGE_ITEMS)
    if usage["leads"]:
        event.usages.append(describe_usage("leads", usage["leads"], "lead", "leads", usage["lead_items"]))


@subscribe(InternalNoteWritten, phase=Phase.TRANSACTION)
async def audit_internal_note(event: InternalNoteWritten) -> None:
    await record_note_activity(
        event.chat_id, action=event.action, actor=Actor.user(event.actor_user_id),
        note_id=event.note_id, old_content=event.old_content, new_content=event.new_content,
        mention_ids=event.mention_ids,
    )


@subscribe(LeadChangedOutside, phase=Phase.AFTER_COMMIT)
async def lead_changed_outside(event: LeadChangedOutside) -> None:
    await manager.broadcast({"type": "chats_updated", "chat_id": event.lead_id, "reason": "lead_updated"}, sellers=await lead_audience(event.lead_id))


@subscribe(LeadStagesChanged, phase=Phase.AFTER_COMMIT)
async def stages_changed(event: LeadStagesChanged) -> None:
    # Kanban, filtros y fichas abiertas rotulan con estas etapas: sin el
    # aviso, un renombre no se vería hasta el siguiente refresco.
    await manager.broadcast({"type": "lead_stages_updated"})



@subscribe(LeadAppointmentScheduled, phase=Phase.TRANSACTION)
async def queue_appointment_conversion(event: LeadAppointmentScheduled) -> None:
    """En la transacción de la cita: si la cita se revierte, el evento para
    Meta no existe. El envío lo hace el worker después. Un fallo acá queda en
    su savepoint y nunca impide guardar la cita."""
    try:
        await queue_appointment_conversions(
            event.lead_id, appointment_id=event.appointment_id, adelanto=event.adelanto,
        )
    except Exception:
        logger.exception("No se pudo encolar la conversión de la cita %s", event.appointment_id)

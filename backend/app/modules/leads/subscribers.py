"""Reacciones de ``leads`` a eventos propios y ajenos.

- Avisos de tiempo real (después del commit): un panel nunca se entera de un
  cambio que la transacción terminó revirtiendo. Reemplazan los
  ``manager.broadcast`` que cada llamador emitía por su cuenta.
- Cambios que otros módulos provocan sobre los leads (en la transacción),
  como seguir el renombre de un servicio del catálogo.
"""

from __future__ import annotations

from app.core.events import Phase, subscribe
from app.modules.catalogs.public import ServiceRenamed
from app.modules.leads.application.commands import rename_service
from app.modules.leads.domain.events import (
    LeadCreated,
    LeadDeleted,
    LeadNoShowRegistered,
    LeadStageChanged,
    LeadsMerged,
    LeadTagged,
    LeadUpdated,
)
from app.modules.leads.domain.lead import BOOKKEEPING_FIELDS, Actor
from app.realtime.ws_manager import manager

@subscribe(LeadCreated, phase=Phase.AFTER_COMMIT)
async def lead_created(event: LeadCreated) -> None:
    await manager.broadcast({"type": "chats_updated", "chat_id": event.lead_id, "reason": "lead_created"})


@subscribe(LeadStageChanged, phase=Phase.AFTER_COMMIT)
async def stage_changed(event: LeadStageChanged) -> None:
    await manager.broadcast({"type": "chats_updated", "chat_id": event.lead_id, "reason": "stage_changed"})


@subscribe(LeadUpdated, phase=Phase.AFTER_COMMIT)
async def lead_updated(event: LeadUpdated) -> None:
    # Las marcas que el sistema mueve en cada mensaje no son una edición:
    # el mensaje ya avisa por su lado.
    if set(event.fields) <= BOOKKEEPING_FIELDS:
        return
    reason = "lead_updated"
    if event.event_type == "conversation_opened":
        reason = "conversation_opened"
    elif event.event_type == "conversation_closed":
        reason = "conversation_closed"
    await manager.broadcast({"type": "chats_updated", "chat_id": event.lead_id, "reason": reason})


@subscribe(LeadNoShowRegistered, phase=Phase.AFTER_COMMIT)
async def no_show_registered(event: LeadNoShowRegistered) -> None:
    await manager.broadcast({"type": "chats_updated", "chat_id": event.lead_id, "reason": "lead_updated"})


@subscribe(LeadTagged, phase=Phase.AFTER_COMMIT)
async def tag_changed(event: LeadTagged) -> None:
    await manager.broadcast({"type": "chats_updated", "chat_id": event.lead_id, "reason": "tag_changed"})


@subscribe(LeadDeleted, phase=Phase.AFTER_COMMIT)
async def lead_deleted(event: LeadDeleted) -> None:
    await manager.broadcast({"type": "chats_updated", "chat_id": event.lead_id, "reason": "lead_deleted"})


@subscribe(LeadsMerged, phase=Phase.AFTER_COMMIT)
async def leads_merged(event: LeadsMerged) -> None:
    await manager.broadcast({"type": "chats_updated", "chat_id": event.lead_id, "reason": "lead_updated"})
    await manager.broadcast({"type": "chats_updated", "chat_id": event.source_id, "reason": "lead_deleted"})


@subscribe(ServiceRenamed, phase=Phase.TRANSACTION)
async def follow_service_rename(event: ServiceRenamed) -> None:
    await rename_service(
        event.old_name, event.new_name,
        actor=Actor.of(event.actor_user_id), service_id=event.service_id,
    )

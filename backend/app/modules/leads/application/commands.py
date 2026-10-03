"""Comandos del lead: cada uno es una transacción con sus eventos.

Es la única puerta para cambiar un lead. La API, los callbacks de n8n, el
motor de automatizaciones y el analista de IA llaman a estas funciones; si
alguno ya está dentro de una unidad de trabajo (p. ej. el analista, que además
marca su job), el comando se suma a esa transacción en lugar de abrir otra.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from app.db.uow import collect, unit_of_work
from app.modules.leads.application.ports import lead_repository
from app.modules.leads.domain.errors import LeadNotFound, SellerNotFound, TagNotAvailable
from app.modules.leads.domain.events import (
    ConversationStarted,
    LeadCreated,
    LeadDeleted,
    LeadNoShowRegistered,
    LeadStageChanged,
    LeadsMerged,
    LeadTagged,
    LeadUpdated,
)
from app.modules.leads.domain.lead import ActivityRecord, Actor, FieldChanges, Lead, audit_safe
from app.modules.leads.domain.stage import require_destination
from domain_types import AutomationTrigger


def _now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass(frozen=True)
class StageChangeResult:
    lead_id: str
    stage: str
    changed: bool


async def _locked(lead_id: str, fields=()) -> Lead:
    lead = await lead_repository().get_for_update(lead_id, fields)
    if lead is None:
        raise LeadNotFound()
    return lead


async def change_stage(
    lead_id: str,
    stage: str,
    *,
    actor: Actor,
    lost_reason: str | None = None,
    metadata: dict | None = None,
    triggers_automations: bool = True,
) -> StageChangeResult:
    """Mueve el lead de etapa. Si ya estaba ahí no valida ni audita nada: un
    lead puede seguir en una etapa que el negocio desactivó."""
    repository = lead_repository()
    async with unit_of_work():
        lead = await _locked(lead_id)
        if lead.stage == stage:
            return StageChangeResult(lead_id, stage, False)
        rules = await repository.stage_rules({lead.stage, stage})
        target = require_destination(rules, stage)
        move = lead.move_to(
            target, rules.get(lead.stage),
            actor=actor, now=_now(), lost_reason=lost_reason, metadata=metadata,
            trigger=await repository.latest_customer_message(lead_id),
        )
        [activity_id] = await repository.save(lead)
        collect(LeadStageChanged(
            lead_id=lead_id, actor=actor, old_stage=move.old_stage, new_stage=move.new_stage,
            activity_id=activity_id, triggers_automations=triggers_automations,
        ))
    return StageChangeResult(lead_id, stage, True)


async def _with_seller_name(values: dict[str, Any]) -> dict[str, Any]:
    """``vendedor`` es un espejo de compatibilidad del nombre; la fuente real
    es ``vendedor_id``, que tiene que apuntar a un vendedor activo."""
    if "vendedor_id" not in values:
        return values
    values = dict(values)
    seller_id = values["vendedor_id"]
    if seller_id is None:
        values["vendedor"] = None
        return values
    name = await lead_repository().seller_name(seller_id)
    if name is None:
        raise SellerNotFound()
    values["vendedor"] = name
    return values


async def create_lead(
    phone: str,
    name: str,
    *,
    actor: Actor,
    servicio_interes: str | None = None,
    vendedor_id: int | None = None,
    origen: str | None = None,
    notas: str | None = None,
    secondary_phone: str | None = None,
    custom_fields: dict | None = None,
) -> str:
    """Alta manual de un lead. ``phone`` llega normalizado (solo dígitos
    E.164): es el ``wa_id`` con el que Meta identifica al contacto."""
    repository = lead_repository()
    async with unit_of_work():
        values = await _with_seller_name({
            "servicio_interes": servicio_interes,
            "vendedor_id": vendedor_id,
            "origen": origen,
            "notas": notas,
            "telefono_secundario": secondary_phone,
            "custom_fields": custom_fields or {},
        })
        lead = Lead.register(phone=phone, name=name, actor=actor, values=values)
        [activity_id] = await repository.add(lead)
        collect(LeadCreated(lead_id=lead.id, actor=actor, activity_id=activity_id))
    return lead.id


async def update_lead(
    lead_id: str,
    values: dict[str, Any],
    *,
    actor: Actor,
    metadata: dict | None = None,
) -> FieldChanges | None:
    """Actualiza columnas del lead y audita solo lo que cambió."""
    repository = lead_repository()
    async with unit_of_work():
        values = await _with_seller_name(values)
        lead = await _locked(lead_id, values.keys())
        changes = lead.update(values, actor=actor, now=_now(), metadata=metadata)
        if changes is not None:
            await repository.save(lead)
            collect(LeadUpdated(
                lead_id=lead_id, actor=actor, fields=changes.fields, event_type=changes.event_type,
                values=audit_safe(changes.new),
            ))
    return changes


async def edit_lead(
    lead_id: str,
    values: dict[str, Any],
    *,
    actor: Actor,
    phone: str | None = None,
) -> None:
    """Edición desde la ficha: teléfono y datos en una sola transacción."""
    async with unit_of_work():
        if phone:
            await change_phone(lead_id, phone, actor=actor)
        await update_lead(lead_id, values, actor=actor)


async def change_phone(lead_id: str, phone: str, *, actor: Actor) -> None:
    """Cambia el ``wa_id`` del lead sin cambiar su identidad interna."""
    repository = lead_repository()
    async with unit_of_work():
        lead = await _locked(lead_id, ("telefono",))
        await repository.replace_phone_identity(lead_id, phone)
        lead.change_phone(phone, actor=actor, now=_now())
        await repository.save(lead)
        collect(LeadUpdated(
            lead_id=lead_id, actor=actor, fields=("telefono",), event_type="lead_updated",
            values={"telefono": phone},
        ))


async def register_no_show(lead_id: str, *, actor: Actor) -> int:
    repository = lead_repository()
    async with unit_of_work():
        lead = await _locked(lead_id)
        count = lead.register_no_show(actor=actor, now=_now())
        await repository.save(lead)
        collect(LeadNoShowRegistered(lead_id=lead_id, actor=actor, count=count))
    return count


async def register_follow_up(lead_id: str, *, actor: Actor) -> int:
    """n8n avisa que mandó un seguimiento: suma un toque al lead."""
    repository = lead_repository()
    async with unit_of_work():
        lead = await _locked(lead_id, ("toques_seguimiento",))
        touches = lead.register_follow_up(now=_now())
        await repository.save(lead)
        collect(LeadUpdated(
            lead_id=lead_id, actor=actor, fields=("toques_seguimiento", "fecha_ultimo_toque"),
            event_type="lead_updated", values={"toques_seguimiento": touches},
        ))
    return touches


async def delete_lead(lead_id: str, *, actor: Actor) -> None:
    """Borra el lead y todo lo que cuelga de él. No hay soft-delete."""
    async with unit_of_work():
        if not await lead_repository().delete(lead_id):
            raise LeadNotFound()
        collect(LeadDeleted(lead_id=lead_id, actor=actor))


async def assign_tag(lead_id: str, tag_id: int, *, actor: Actor) -> None:
    repository = lead_repository()
    async with unit_of_work():
        lead = await repository.get_for_update(lead_id)
        tag = await repository.active_tag(tag_id)
        if lead is None or tag is None:
            raise TagNotAvailable("Lead o etiqueta no encontrados")
        if await repository.assigned_tag(lead_id, tag_id) is not None:
            return
        await repository.add_tag(lead_id, tag_id, actor.user_id)
        lead.record_tag(tag, added=True, actor=actor)
        await repository.save(lead)
        collect(LeadTagged(lead_id=lead_id, actor=actor, tag_id=tag_id, added=True))


async def remove_tag(lead_id: str, tag_id: int, *, actor: Actor) -> None:
    repository = lead_repository()
    async with unit_of_work():
        tag = await repository.assigned_tag(lead_id, tag_id)
        lead = await repository.get_for_update(lead_id) if tag is not None else None
        if lead is None:
            raise TagNotAvailable("La etiqueta no está asignada")
        await repository.remove_tag(lead_id, tag_id)
        lead.record_tag(tag, added=False, actor=actor)
        await repository.save(lead)
        collect(LeadTagged(lead_id=lead_id, actor=actor, tag_id=tag_id, added=False))


async def open_conversation_from_inbound(
    lead_id: str,
    message_id: str,
    content: str | None = None,
) -> dict | None:
    """Abre una conversación cerrada por un mensaje entrante, o ``None`` si
    ya estaba abierta. La versión identifica esta apertura de forma estable
    para deduplicar la ejecución de cada regla."""
    repository = lead_repository()
    actor = Actor.system()
    async with unit_of_work():
        opened = await repository.open_conversation(lead_id)
        if opened is None:
            return None
        version, opened_at = opened
        await repository.record_activity(lead_id, ActivityRecord(
            AutomationTrigger.CONVERSATION_STARTED, actor,
            old_value={"conversacion_abierta": False},
            new_value={"conversacion_abierta": True, "conversacion_version": version},
            metadata={"message_id": message_id, "content": content},
        ))
        collect(ConversationStarted(
            lead_id=lead_id, actor=actor, version=version, message_id=message_id, content=content,
        ))
    return {"version": version, "opened_at": opened_at}


async def rename_service(old_name: str, new_name: str, *, actor: Actor, service_id: int) -> None:
    """El catálogo renombró un servicio: los leads que lo tenían lo siguen.

    No avisa lead por lead por WebSocket: un renombre puede tocar miles de
    fichas y el panel de servicios ya refresca lo suyo.
    """
    repository = lead_repository()
    async with unit_of_work():
        for lead_id in await repository.rename_service(old_name, new_name):
            await repository.record_activity(lead_id, ActivityRecord(
                "lead_updated", actor,
                old_value={"servicio_interes": old_name},
                new_value={"servicio_interes": new_name},
                metadata={"source": "service_catalog", "service_id": service_id},
            ))


async def record_note_activity(
    lead_id: str,
    *,
    action: str,
    actor: Actor,
    note_id: int,
    old_content: str | None,
    new_content: str | None,
    mention_ids: tuple[int, ...],
) -> None:
    """Las notas internas son de ``conversations``, pero quedan en la
    auditoría comercial del lead, que es de ``leads``."""
    metadata: dict = {"note_id": note_id}
    if action != "deleted":
        metadata["mentioned_user_ids"] = list(mention_ids)
    async with unit_of_work():
        await lead_repository().record_activity(lead_id, ActivityRecord(
            f"internal_note_{action}", actor,
            old_value={"content": old_content} if old_content is not None else None,
            new_value={"content": new_content} if new_content is not None else None,
            metadata=metadata,
        ))


async def merge_leads(source_id: str, target_id: str, *, actor: Actor) -> None:
    """Fusiona ``source_id`` (se borra) dentro de ``target_id`` (se conserva)."""
    async with unit_of_work():
        await lead_repository().merge(source_id, target_id)
        collect(LeadsMerged(lead_id=target_id, actor=actor, source_id=source_id))

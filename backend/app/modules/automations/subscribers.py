"""Lo que el motor de automatizaciones hace cuando cambia un lead.

``leads`` no conoce a este módulo: publica sus eventos y acá se decide qué
flujos agendar. El agendado corre dentro de la transacción del cambio, así que
un lead nunca queda movido sin sus ejecuciones (ni al revés). Un error al
agendar se registra y no revierte el cambio de etapa, igual que antes: se
aísla en un savepoint.
"""

from __future__ import annotations

import logging

from sqlalchemy import select, update
from sqlalchemy.exc import SQLAlchemyError

from app.core.events import Phase, subscribe
from app.db.models.automations import AutomationRule
from app.db.uow import collect, current_session
from app.modules.automations.automation_scheduling import schedule_automation_event_in_session
from app.modules.automations.domain.events import AutomationsScheduled
from app.modules.automations.rules import pause_lead_executions, resume_lead_executions
from app.modules.automations.scheduler import notify_automations_scheduled, trigger_inbound_message
from app.modules.catalogs.public import ServiceRenamed, rename_service_references
from app.modules.conversations.ports.message_queries import fetch_message_by_wa_id
from app.modules.conversations.public import ExternalMessageDetected, ProviderMessageStored
from app.modules.leads.public import LeadCreated, LeadStageChanged, LeadUpdated
from domain_types import AutomationTrigger

logger = logging.getLogger(__name__)


async def _schedule(trigger: AutomationTrigger, lead_id: str, event_key: str, payload: dict | None = None) -> None:
    session = current_session()
    try:
        async with session.begin_nested():
            created = await schedule_automation_event_in_session(session, trigger, lead_id, event_key, payload)
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


@subscribe(AutomationsScheduled, phase=Phase.AFTER_COMMIT)
async def wake_the_engine(event: AutomationsScheduled) -> None:
    await notify_automations_scheduled(event.count)


_RULE_FIELDS_WITH_SERVICES = ("conditions", "actions", "flow_definition", "published_flow_definition")


@subscribe(ServiceRenamed, phase=Phase.TRANSACTION)
async def follow_service_rename(event: ServiceRenamed) -> None:
    """Las reglas referencian servicios por nombre en condiciones, acciones y
    en el flujo publicado: siguen el renombre en la misma transacción."""
    session = current_session()
    columns = [getattr(AutomationRule, name) for name in _RULE_FIELDS_WITH_SERVICES]
    rules = (await session.execute(select(AutomationRule.id, *columns))).mappings().all()
    for rule in rules:
        values = {}
        for name in _RULE_FIELDS_WITH_SERVICES:
            renamed, changed = rename_service_references(rule[name], event.old_name, event.new_name)
            if changed:
                values[name] = renamed
        if values:
            await session.execute(update(AutomationRule).where(AutomationRule.id == rule["id"]).values(**values))


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

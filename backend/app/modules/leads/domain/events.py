"""Eventos del lead. Los consumen otros módulos sin que ``leads`` los conozca:
automatizaciones agenda flujos, tiempo real avisa a los paneles."""

from __future__ import annotations

from dataclasses import dataclass, field

from app.core.events import DomainEvent
from app.modules.leads.domain.lead import Actor


@dataclass(frozen=True, kw_only=True)
class LeadEvent(DomainEvent):
    lead_id: str
    actor: Actor


@dataclass(frozen=True, kw_only=True)
class LeadCreated(LeadEvent):
    activity_id: int


@dataclass(frozen=True, kw_only=True)
class LeadStageChanged(LeadEvent):
    old_stage: str
    new_stage: str
    activity_id: int
    # Una automatización que mueve el lead no vuelve a disparar las de cambio
    # de etapa: si no, dos reglas podrían moverlo en ciclo.
    triggers_automations: bool = True


@dataclass(frozen=True, kw_only=True)
class LeadUpdated(LeadEvent):
    fields: tuple[str, ...]
    event_type: str
    # Valores nuevos de lo que cambió (serializables, como en la auditoría).
    values: dict = field(default_factory=dict)


@dataclass(frozen=True, kw_only=True)
class ConversationStarted(LeadEvent):
    """Un mensaje entrante abrió una conversación que estaba cerrada."""

    version: int
    message_id: str
    content: str | None


@dataclass(frozen=True, kw_only=True)
class LeadNoShowRegistered(LeadEvent):
    count: int


@dataclass(frozen=True, kw_only=True)
class LeadTagged(LeadEvent):
    tag_id: int
    added: bool


@dataclass(frozen=True, kw_only=True)
class LeadDeleted(LeadEvent):
    pass


@dataclass(frozen=True, kw_only=True)
class LeadsMerged(LeadEvent):
    """``source_id`` se fusionó dentro de ``lead_id`` y dejó de existir."""

    source_id: str

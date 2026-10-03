"""Dobles en memoria para probar los casos de uso de leads sin PostgreSQL.

``InMemoryLeadRepository`` implementa el puerto ``LeadRepository`` y
``in_memory_leads`` lo instala junto con una sesión falsa para la unidad de
trabajo: los comandos corren tal cual, con sus eventos, pero sin base.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from dataclasses import dataclass, field, replace
from typing import Any

import pytest

from app.core import events
from app.db import uow
from app.modules.leads.application import ports
from app.modules.leads.domain.errors import LeadAlreadyExists
from app.modules.leads.domain.lead import ActivityRecord, Lead, TriggerMessage
from app.modules.leads.domain.stage import StageRule
from app.modules.leads.ports.types import LeadStageKind

DEFAULT_STAGES = {
    "nuevo": StageRule("nuevo", LeadStageKind.OPEN, True),
    "calificado": StageRule("calificado", LeadStageKind.OPEN, True),
    "cliente_activo": StageRule("cliente_activo", LeadStageKind.WON, True),
    "perdido": StageRule("perdido", LeadStageKind.LOST, True),
    "archivada": StageRule("archivada", LeadStageKind.OPEN, False),
}


@dataclass
class StoredLead:
    lead: Lead
    columns: dict[str, Any] = field(default_factory=dict)
    tags: set[int] = field(default_factory=set)


class InMemoryLeadRepository:
    def __init__(self) -> None:
        self.leads: dict[str, StoredLead] = {}
        self.activities: list[tuple[str, ActivityRecord]] = []
        self.stages = dict(DEFAULT_STAGES)
        self.sellers: dict[int, str] = {7: "Luis"}
        self.tags: dict[int, dict] = {1: {"id": 1, "name": "VIP", "color": "#16a34a"}}
        self.messages: dict[str, TriggerMessage] = {}
        self.open_conversations: set[str] = set()
        self.merged: list[tuple[str, str]] = []
        self.renamed: list[tuple[str, str]] = []

    def seed(self, lead_id: str = "lead-1", *, stage: str = "nuevo", **columns: Any) -> str:
        columns.setdefault("telefono", "51999")
        lead = Lead(id=lead_id, stage=stage, phone=columns["telefono"])
        self.leads[lead_id] = StoredLead(lead, {"estado": stage, **columns})
        return lead_id

    def column(self, lead_id: str, name: str) -> Any:
        return self.leads[lead_id].columns.get(name)

    def audit(self, lead_id: str | None = None) -> list[ActivityRecord]:
        return [record for owner, record in self.activities if lead_id in (None, owner)]

    async def get_for_update(self, lead_id, fields=()):
        stored = self.leads.get(lead_id)
        if stored is None:
            return None
        columns = stored.columns
        return replace(
            stored.lead,
            stage=columns.get("estado", stored.lead.stage),
            lost_reason=columns.get("razon_perdido"),
            no_show_count=columns.get("contador_noshow") or 0,
            conversation_version=columns.get("conversacion_version") or 0,
            values={name: columns.get(name) for name in fields},
            changes={},
            activities=[],
        )

    async def add(self, lead: Lead) -> list[int]:
        if any(stored.lead.phone == lead.phone for stored in self.leads.values()):
            raise LeadAlreadyExists(lead.phone)
        self.leads[lead.id] = StoredLead(replace(lead, changes={}, activities=[]), {"estado": lead.stage, **lead.changes})
        lead.changes.clear()
        return await self._flush(lead)

    async def save(self, lead: Lead) -> list[int]:
        self.leads[lead.id].columns.update(lead.changes)
        self.leads[lead.id].lead.phone = lead.phone
        lead.changes.clear()
        return await self._flush(lead)

    async def _flush(self, lead: Lead) -> list[int]:
        ids = [await self.record_activity(lead.id, record) for record in lead.activities]
        lead.activities.clear()
        return ids

    async def record_activity(self, lead_id, record) -> int:
        self.activities.append((lead_id, record))
        return len(self.activities)

    async def delete(self, lead_id) -> bool:
        return self.leads.pop(lead_id, None) is not None

    async def stage_rules(self, keys):
        return {key: self.stages[key] for key in keys if key in self.stages}

    async def seller_name(self, seller_id):
        return self.sellers.get(seller_id)

    async def latest_customer_message(self, lead_id):
        return self.messages.get(lead_id)

    async def replace_phone_identity(self, lead_id, new_phone):
        if any(stored.lead.phone == new_phone for key, stored in self.leads.items() if key != lead_id):
            raise LeadAlreadyExists(new_phone)

    async def active_tag(self, tag_id):
        return self.tags.get(tag_id)

    async def assigned_tag(self, lead_id, tag_id):
        stored = self.leads.get(lead_id)
        return self.tags.get(tag_id) if stored and tag_id in stored.tags else None

    async def add_tag(self, lead_id, tag_id, assigned_by):
        self.leads[lead_id].tags.add(tag_id)

    async def remove_tag(self, lead_id, tag_id):
        self.leads[lead_id].tags.discard(tag_id)

    async def open_conversation(self, lead_id):
        if lead_id in self.open_conversations or lead_id not in self.leads:
            return None
        self.open_conversations.add(lead_id)
        version = (self.leads[lead_id].columns.get("conversacion_version") or 0) + 1
        self.leads[lead_id].columns["conversacion_version"] = version
        return version, "2026-07-20T15:00:00.000000Z"

    async def merge(self, source_id, target_id):
        self.merged.append((source_id, target_id))
        self.leads.pop(source_id, None)

    async def rename_service(self, old_name, new_name):
        touched = [
            lead_id for lead_id, stored in self.leads.items()
            if (stored.columns.get("servicio_interes") or "").strip().lower() == old_name.lower()
        ]
        for lead_id in touched:
            self.leads[lead_id].columns["servicio_interes"] = new_name
        self.renamed.append((old_name, new_name))
        return touched


class _FakeSession:
    """Lo mínimo que la unidad de trabajo usa de una sesión."""

    @asynccontextmanager
    async def begin(self):
        yield self

    async def close(self) -> None:
        return None


@dataclass
class LeadsWorld:
    repository: InMemoryLeadRepository
    published: list[events.DomainEvent]


@pytest.fixture
def in_memory_leads(monkeypatch) -> LeadsWorld:
    repository = InMemoryLeadRepository()
    published: list[events.DomainEvent] = []
    monkeypatch.setattr(ports, "_repository", repository)
    monkeypatch.setattr(uow, "get_sessionmaker", lambda: _FakeSession)

    async def record(pending):
        published.extend(pending)

    # Se registran los eventos en vez de despacharlos a los suscriptores
    # reales, que hablan con la base.
    monkeypatch.setattr(uow, "dispatch_in_transaction", record)

    async def nothing_after_commit(_events):
        return None

    monkeypatch.setattr(uow, "dispatch_after_commit", nothing_after_commit)
    return LeadsWorld(repository, published)

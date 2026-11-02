"""Puertos de las citas en memoria, para probar los casos de uso sin base,
sin Google y sin n8n."""

from __future__ import annotations

import itertools
from contextlib import asynccontextmanager
from dataclasses import dataclass, field

import pytest

from app.db import uow
from app.modules.appointments.application import ports
from app.modules.appointments.application.ports import AppointmentPorts
from app.modules.appointments.domain.appointment import SyncResult


class FakeAppointments:
    def __init__(self) -> None:
        self.rows: dict[int, dict] = {}
        self.order: list[str] = []
        self._ids = itertools.count(41)

    async def add(self, values: dict) -> dict:
        self.order.append("saved")
        appointment_id = next(self._ids)
        self.rows[appointment_id] = {
            "id": appointment_id, "created_by_name": "Asesor", "lead_owner_name": None,
            "calendar_event_id": None, "calendar_sync_error": None,
            "created_at": "2026-09-24T12:00:00Z", **values,
        }
        return dict(self.rows[appointment_id])

    async def get(self, appointment_id: int) -> dict | None:
        row = self.rows.get(appointment_id)
        return dict(row) if row else None

    async def record_integrations(self, appointment_id: int, *, clear_calendar_sync_error: bool = False, **values) -> dict:
        row = self.rows[appointment_id]
        row.update({key: value for key, value in values.items() if value is not None})
        if clear_calendar_sync_error:
            row["calendar_sync_error"] = None
        return dict(row)


@dataclass
class FakeCalendar:
    result: dict = field(default_factory=lambda: {
        "status": "not_configured", "event_id": None, "event_link": None, "error": None,
    })
    calls: list[dict] = field(default_factory=list)
    order: list[str] | None = None

    async def create_event(self, appointment: dict, field_labels: dict[str, str]) -> dict:
        self.calls.append(appointment)
        if self.order is not None:
            self.order.append("calendar")
        return dict(self.result)


@dataclass
class FakeSync:
    result: SyncResult = field(default_factory=lambda: SyncResult(configured=False))
    submitted: list[dict] = field(default_factory=list)
    order: list[str] | None = None

    async def submit(self, *, test_mode: bool, form: dict, files: dict | None) -> SyncResult:
        self.submitted.append({"test_mode": test_mode, "form": form, "files": files})
        if self.order is not None:
            self.order.append("n8n")
        return self.result


@dataclass
class FakeLeads:
    identities: dict[str, str] = field(default_factory=dict)
    tails: dict[str, str] = field(default_factory=dict)
    tail_lookups: list[str] = field(default_factory=list)

    async def by_whatsapp_identity(self, e164: str) -> str | None:
        return self.identities.get(e164)

    async def by_phone_tail(self, tail: str) -> str | None:
        self.tail_lookups.append(tail)
        return self.tails.get(tail)


@dataclass
class AppointmentWorld:
    repository: FakeAppointments
    calendar: FakeCalendar
    sync: FakeSync
    leads: FakeLeads
    published: list

    def of(self, event_type):
        return [event for event in self.published if isinstance(event, event_type)]


class _FakeSession:
    @asynccontextmanager
    async def begin(self):
        yield self

    async def close(self) -> None:
        return None


@pytest.fixture
def in_memory_appointments(monkeypatch) -> AppointmentWorld:
    repository = FakeAppointments()
    world = AppointmentWorld(
        repository=repository,
        calendar=FakeCalendar(order=repository.order),
        sync=FakeSync(order=repository.order),
        leads=FakeLeads(),
        published=[],
    )
    monkeypatch.setattr(ports, "_ports", AppointmentPorts(
        repository=world.repository, calendar=world.calendar, sync=world.sync, leads=world.leads,
    ))
    monkeypatch.setattr(uow, "get_sessionmaker", lambda: _FakeSession)

    async def record(pending):
        world.published.extend(pending)

    async def nothing(_events):
        return None

    monkeypatch.setattr(uow, "dispatch_in_transaction", record)
    monkeypatch.setattr(uow, "dispatch_after_commit", nothing)
    return world

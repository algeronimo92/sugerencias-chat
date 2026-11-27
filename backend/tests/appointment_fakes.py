"""Puertos de las citas en memoria, para probar los casos de uso sin base,
sin Google y sin n8n."""

from __future__ import annotations

import itertools
from datetime import timezone
from contextlib import asynccontextmanager
from dataclasses import dataclass, field

import pytest

from app.db import uow
from app.modules.appointments.application import ports
from app.modules.appointments.application.ports import AppointmentPorts
from app.modules.appointments.domain.appointment import SyncResult
from tests.permission_fakes import use_role_matrix


class FakeAppointments:
    def __init__(self) -> None:
        self.rows: dict[int, dict] = {}
        self.order: list[str] = []
        self._ids = itertools.count(41)

    async def add(self, values: dict) -> dict | None:
        request_id = values.get("client_request_id")
        # Como el índice único: mira las filas, no ``by_client_request``.
        if request_id is not None and any(row.get("client_request_id") == request_id for row in self.rows.values()):
            return None
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

    async def get_many(self, appointment_ids: set[int]) -> dict[int, dict]:
        return {key: dict(row) for key, row in self.rows.items() if key in appointment_ids}

    async def flag_calendar_change(self, appointment_id: int, *, summary: str, starts_at, at) -> bool:
        row = self.rows[appointment_id]
        change = row.get("calendar_change")
        row["calendar_change"] = {
            "summary": summary, "starts_at": starts_at.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
            "detected_at": at.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        }
        return change is None or change["summary"] != summary

    async def clear_calendar_change(self, appointment_id: int) -> None:
        self.rows[appointment_id]["calendar_change"] = None

    async def confirm_calendar_change(self, appointment_id: int, *, tratamiento: str, fecha, hora) -> dict | None:
        row = self.rows.get(appointment_id)
        if row is None or not row.get("calendar_change"):
            return None
        row.update(tratamiento=tratamiento, calendar_confirmed_summary=row["calendar_change"]["summary"], calendar_change=None)
        if fecha is not None and hora is not None:
            row.update(fecha=fecha.isoformat(), hora=hora)
        return dict(row)

    async def by_client_request(self, client_request_id: str) -> dict | None:
        found = [row for row in self.rows.values() if row.get("client_request_id") == client_request_id]
        return dict(found[0]) if found else None

    async def latest_real(self) -> dict | None:
        real =[row for row in self.rows.values() if not row.get("test_mode") and not row.get("dismissed_at")]
        return dict(real[-1]) if real else None

    async def set_dismissed(self, appointment_id: int, *, user_id: int | None, reason: str | None) -> dict | None:
        row = self.rows.get(appointment_id)
        if row is None:
            return None
        row.update(
            {"dismissed_at": "2026-11-14T15:00:00Z", "dismissed_by_user_id": user_id, "dismissed_reason": reason}
            if user_id is not None
            else {"dismissed_at": None, "dismissed_by_user_id": None, "dismissed_reason": None}
        )
        return dict(row)

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
    contents: list = field(default_factory=list)
    order: list[str] | None = None

    # Lo que devuelve Google Calendar al leer los eventos (None: sin conectar).
    events: list | None = None
    events_error: Exception | None = None
    reads: list[tuple] = field(default_factory=list)

    async def upcoming_events(self, time_min, time_max):
        self.reads.append((time_min, time_max))
        if self.events_error is not None:
            raise self.events_error
        return None if self.events is None else list(self.events)

    async def create_event(self, appointment: dict, content) -> dict:
        self.calls.append(appointment)
        self.contents.append(content)
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
    existing: set[str] = field(default_factory=set)
    registered: list[dict] = field(default_factory=list)
    snapshots: dict[str, dict] = field(default_factory=dict)
    # Cola -> leads sin teléfono cuyo cliente escribió ese número en el chat.
    chat_mentions: dict[str, list[str]] = field(default_factory=dict)
    created: list[dict] = field(default_factory=list)
    create_error: Exception | None = None

    async def snapshot(self, lead_id: str) -> dict | None:
        return self.snapshots.get(lead_id)

    async def by_whatsapp_identity(self, e164: str) -> str | None:
        return self.identities.get(e164)

    async def by_phone_tail(self, tail: str) -> list[str]:
        self.tail_lookups.append(tail)
        found = self.tails.get(tail)
        return [found] if isinstance(found, str) else list(found or [])

    async def by_phone_in_chat(self, tail: str) -> list[str]:
        return list(self.chat_mentions.get(tail, []))

    async def exists(self, lead_id: str) -> bool:
        return lead_id in self.existing

    async def create(self, *, phone: str, name: str, actor_user_id: int, seller_name: str) -> str:
        if self.create_error is not None:
            raise self.create_error
        lead_id = f"lead-nuevo-{len(self.created) + 1}"
        self.created.append({"phone": phone, "name": name, "actor_user_id": actor_user_id, "seller_name": seller_name})
        self.existing.add(lead_id)
        self.identities[phone] = lead_id
        return lead_id

    async def register(self, lead_id: str, **values) -> None:
        self.registered.append({"lead_id": lead_id, **values})


@dataclass
class FakeMessenger:
    sent: list[dict] = field(default_factory=list)
    to_phones: list[dict] = field(default_factory=list)
    error: Exception | None = None
    failing_phones: set[str] = field(default_factory=set)
    from_sender: list[dict] = field(default_factory=list)

    async def send_to_lead(self, **values) -> int | None:
        if self.error is not None:
            raise self.error
        self.sent.append(values)
        return 9000 + len(self.sent)

    async def send_to_phone(
        self, *, phone: str, template: dict, parameters: list[str], sender: str | None = None,
    ) -> str | None:
        if phone in self.failing_phones and self.error is not None:
            raise self.error
        sent = {"phone": phone, "template_id": template["id"], "parameters": parameters}
        self.to_phones.append({**sent, "sender": sender} if sender else sent)
        return f"wamid.{phone}"

    async def send_to_lead_from(
        self, *, chat_id: str, template: dict, parameters: list[str], sender: str,
    ) -> str | None:
        if self.error is not None:
            raise self.error
        self.from_sender.append({
            "chat_id": chat_id, "template_id": template["id"], "parameters": parameters, "sender": sender,
        })
        return f"wamid.lead.{chat_id}"


@dataclass
class FakeStaff:
    team: list[dict] = field(default_factory=list)
    asked: list[str] = field(default_factory=list)

    async def recipients(self, seller_name: str) -> list[dict]:
        self.asked.append(seller_name)
        return list(self.team)


@dataclass
class FakeNotices:
    rows: list[dict] = field(default_factory=list)
    deliveries: list[dict] = field(default_factory=list)

    async def record(self, appointment_id: int, notices: list[dict]) -> None:
        for notice in notices:
            self.rows.append({"id": len(self.rows) + 1, "appointment_id": appointment_id, **notice})

    async def failed(self, appointment_id: int) -> list[dict]:
        return [
            dict(row) for row in self.rows
            if row["appointment_id"] == appointment_id
            and (row["status"] == "failed" or row.get("delivery_status") == "failed")
        ]

    async def record_retries(self, appointment_id: int, attempts: list[tuple[int, dict]]) -> None:
        for notice_id, notice in attempts:
            index = next(i for i, row in enumerate(self.rows) if row["id"] == notice_id)
            self.rows[index] = {"id": notice_id, "appointment_id": appointment_id, **notice}

    async def record_delivery(self, **values) -> int:
        self.deliveries.append(values)
        return 1


@dataclass
class FakeSenders:
    available: list[dict] = field(default_factory=lambda: [
        {"id": "CRM_ID", "display_phone_number": "+51 900 000 000", "verified_name": "Clínica",
         "waba_id": "WABA_ID", "is_crm": True},
        {"id": "AVISOS_ID", "display_phone_number": "+51 900 000 999", "verified_name": "Clínica avisos",
         "waba_id": "WABA_ID", "is_crm": False},
    ])
    # Números de otras WABA del portfolio (la propia del número de avisos).
    accounts: dict[str, list[dict]] = field(default_factory=dict)
    # Plantillas en Meta de cada WABA: {name, language, status}.
    account_templates: dict[str, list[dict]] = field(default_factory=dict)
    registered: list[str] = field(default_factory=list)
    registered_accounts: list[str | None] = field(default_factory=list)
    unregistered: list[str] = field(default_factory=list)
    signups: list[dict] = field(default_factory=list)
    signup_error: Exception | None = None
    signup_account: str | None = None
    copies: list[tuple[str, str]] = field(default_factory=list)
    copy_error: Exception | None = None

    async def numbers(self, extra_waba_id: str | None = None) -> list[dict]:
        return list(self.available) + list(self.accounts.get(extra_waba_id or "", []))

    async def account_name(self, waba_id: str) -> str:
        return f"Cuenta {waba_id}"

    async def register(self, phone_number_id: str, waba_id: str | None = None) -> None:
        self.registered.append(phone_number_id)
        self.registered_accounts.append(waba_id)

    async def unregister(self, phone_number_id: str) -> None:
        self.unregistered.append(phone_number_id)

    async def complete_signup(
        self, code: str, waba_id: str, phone_number_id: str | None, *, mode: str = "business_app",
    ) -> dict[str, str]:
        self.signups.append({"code": code, "waba_id": waba_id, "phone_number_id": phone_number_id, "mode": mode})
        if self.signup_error is not None:
            raise self.signup_error
        return {"phone_number_id": phone_number_id or "AVISOS_ID", "waba_id": self.signup_account or waba_id}

    async def templates(self, waba_id: str) -> list[dict]:
        return list(self.account_templates.get(waba_id, []))

    async def copy_template(self, meta_template_id: str, waba_id: str) -> None:
        if self.copy_error is not None:
            raise self.copy_error
        self.copies.append((meta_template_id, waba_id))


@dataclass
class FakeReminders:
    rows: list[dict] = field(default_factory=list)
    deliveries: list[dict] = field(default_factory=list)

    async def claim(self, event, offset_minutes: int) -> int | None:
        key = (event.id, offset_minutes, event.starts_at)
        if any(row["key"] == key for row in self.rows):
            return None
        self.rows.append({
            "id": len(self.rows) + 1, "key": key, "offset_minutes": offset_minutes,
            "appointment_id": event.appointment_id, "event_summary": event.summary, "status": "pending",
        })
        return len(self.rows)

    async def finish(self, reminder_id: int, result: dict) -> None:
        self.rows[reminder_id - 1].update(result)

    async def recent(self, limit: int) -> list[dict]:
        return []

    async def record_delivery(self, **values) -> int:
        self.deliveries.append(values)
        return sum(1 for row in self.rows if row.get("provider_message_id") == values["provider_message_id"])


@dataclass
class AppointmentWorld:
    repository: FakeAppointments
    calendar: FakeCalendar
    sync: FakeSync
    leads: FakeLeads
    published: list
    messenger: FakeMessenger = field(default_factory=FakeMessenger)
    staff: FakeStaff = field(default_factory=FakeStaff)
    notices: FakeNotices = field(default_factory=FakeNotices)
    senders: FakeSenders = field(default_factory=FakeSenders)
    reminders: FakeReminders = field(default_factory=FakeReminders)

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
    from unittest.mock import AsyncMock
    from app.modules.leads import visibility

    # El negocio del doble usa la visibilidad por defecto; no lee PostgreSQL.
    use_role_matrix(monkeypatch)
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
        messenger=world.messenger, staff=world.staff, notices=world.notices, senders=world.senders,
        reminders=world.reminders,
    ))
    monkeypatch.setattr(uow, "get_sessionmaker", lambda: _FakeSession)

    async def record(pending):
        world.published.extend(pending)

    async def nothing(_events):
        return None

    monkeypatch.setattr(uow, "dispatch_in_transaction", record)
    monkeypatch.setattr(uow, "dispatch_after_commit", nothing)
    return world

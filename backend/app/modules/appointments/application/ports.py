"""Puertos de las citas: dónde se guardan, el calendario externo, el
sincronizador de n8n y cómo se encuentra el lead de un teléfono."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from app.modules.appointments.domain.appointment import SyncResult


class AppointmentRepository(Protocol):
    async def add(self, values: dict) -> dict: ...

    async def get(self, appointment_id: int) -> dict | None: ...

    async def record_integrations(self, appointment_id: int, **values) -> dict:
        """Guarda el resultado de las integraciones. ``clear_calendar_sync_error``
        borra un error anterior del calendario."""


class CalendarProvider(Protocol):
    async def create_event(self, appointment: dict, field_labels: dict[str, str]) -> dict:
        """``{status, event_id, event_link, error}``; ``status`` es
        ``synced``, ``not_configured`` o ``error``. Nunca levanta."""


class AppointmentSync(Protocol):
    async def submit(self, *, test_mode: bool, form: dict, files: dict | None) -> SyncResult: ...


class LeadMatcher(Protocol):
    async def by_whatsapp_identity(self, e164: str) -> str | None: ...

    async def by_phone_tail(self, tail: str) -> str | None:
        """El único lead cuyo teléfono termina en ``tail``; None si no hay
        ninguno o hay más de uno."""


@dataclass(frozen=True)
class AppointmentPorts:
    repository: AppointmentRepository
    calendar: CalendarProvider
    sync: AppointmentSync
    leads: LeadMatcher


_ports: AppointmentPorts | None = None


def provide_appointment_ports(ports: AppointmentPorts) -> None:
    global _ports
    _ports = ports


def appointment_ports() -> AppointmentPorts:
    if _ports is None:
        raise RuntimeError("Los puertos de citas no están configurados (app.composition)")
    return _ports

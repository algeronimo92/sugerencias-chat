"""Puertos de las citas: dónde se guardan, el calendario externo, el
sincronizador de n8n, cómo se encuentra el lead de un teléfono y cómo se le
escribe al cliente."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Protocol

from app.modules.appointments.domain.appointment import SyncResult
from app.modules.appointments.domain.calendar_event import EventContent


class AppointmentRepository(Protocol):
    async def add(self, values: dict) -> dict: ...

    async def get(self, appointment_id: int) -> dict | None: ...

    async def latest_real(self) -> dict | None:
        """La última cita que no es de prueba (para las vistas previas)."""

    async def record_integrations(self, appointment_id: int, **values) -> dict:
        """Guarda el resultado de las integraciones. ``clear_calendar_sync_error``
        borra un error anterior del calendario."""


class CalendarProvider(Protocol):
    async def create_event(self, appointment: dict, content: EventContent) -> dict:
        """El evento de la cita con el título y la descripción ya armados.
        ``{status, event_id, event_link, error}``; ``status`` es
        ``synced``, ``not_configured`` o ``error``. Nunca levanta."""


class AppointmentSync(Protocol):
    async def submit(self, *, test_mode: bool, form: dict, files: dict | None) -> SyncResult: ...


class AppointmentLeads(Protocol):
    async def by_whatsapp_identity(self, e164: str) -> str | None: ...

    async def by_phone_tail(self, tail: str) -> str | None:
        """El único lead cuyo teléfono termina en ``tail``; None si no hay
        ninguno o hay más de uno."""

    async def exists(self, lead_id: str) -> bool: ...

    async def snapshot(self, lead_id: str) -> dict | None:
        """La fila del lead (nombre, teléfono, campos personalizados…), o None."""

    async def register(
        self, lead_id: str, *, actor_user_id: int, appointment: dict,
        starts_at: datetime | None, updates: dict[str, Any], custom_fields: dict[str, Any],
        note: str,
    ) -> None:
        """Le cuenta al lead que se le agendó la cita, dentro de la
        transacción en curso (ver ``leads.register_appointment``), y le deja
        ``note`` como nota interna a nombre de quien agendó."""


class NoticeMessenger(Protocol):
    async def send_to_lead(
        self, *, chat_id: str, template_id: int, parameters: list[str], user_id: int, dedupe_key: str,
    ) -> None:
        """Encola la plantilla oficial en el chat del lead. Levanta
        ``NoticeNotSent`` si no se pudo encolar."""

    async def send_to_phone(self, *, phone: str, template: dict, parameters: list[str]) -> None:
        """Manda la plantilla directo a un número del equipo, sin abrir un
        chat en el CRM. Levanta ``NoticeNotSent`` si Meta no la aceptó."""


class StaffDirectory(Protocol):
    async def recipients(self, seller_name: str) -> list[dict]:
        """``{id, name, phone}`` del responsable de la cita (por nombre) y de
        los admins activos, sin repetir y solo los que tienen teléfono."""


@dataclass(frozen=True)
class AppointmentPorts:
    repository: AppointmentRepository
    calendar: CalendarProvider
    sync: AppointmentSync
    leads: AppointmentLeads
    messenger: NoticeMessenger
    staff: StaffDirectory


_ports: AppointmentPorts | None = None


def provide_appointment_ports(ports: AppointmentPorts) -> None:
    global _ports
    _ports = ports


def appointment_ports() -> AppointmentPorts:
    if _ports is None:
        raise RuntimeError("Los puertos de citas no están configurados (app.composition)")
    return _ports

"""Eventos de las citas."""

from __future__ import annotations

from dataclasses import dataclass

from app.core.events import DomainEvent


@dataclass(frozen=True, kw_only=True)
class AppointmentCreated(DomainEvent):
    """Se registró una cita real (no de prueba). Después del commit se
    enteran quien la cargó, el responsable elegido (``seller_name``), los
    admins y, si el negocio lo configuró, el cliente."""

    appointment_id: int
    created_by_user_id: int
    seller_name: str
    title: str
    text: str
    lead_id: str | None = None


@dataclass(frozen=True, kw_only=True)
class NoticeTemplatesChanged(DomainEvent):
    """Meta cambió una plantilla de la cuenta propia del número de avisos
    (las copias de los avisos). Esas copias no se guardan en el CRM: la
    tarjeta del número de avisos las vuelve a leer de Meta."""


@dataclass(frozen=True, kw_only=True)
class AppointmentCalendarChanged(DomainEvent):
    """El evento de la cita se editó a mano en Google Calendar y ya no dice
    lo mismo que el CRM. Se enteran quien la cargó, el responsable y los
    admins, para confirmar el cambio; hasta entonces no salen recordatorios."""

    appointment_id: int
    created_by_user_id: int
    seller_name: str
    title: str
    text: str
    lead_id: str | None = None

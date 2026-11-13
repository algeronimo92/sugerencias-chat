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

"""Eventos de las citas."""

from __future__ import annotations

from dataclasses import dataclass

from app.core.events import DomainEvent


@dataclass(frozen=True, kw_only=True)
class AppointmentCreated(DomainEvent):
    """Se registró una cita real (no de prueba). Quien la cargó y los admins
    se enteran después del commit."""

    appointment_id: int
    created_by_user_id: int
    title: str
    text: str

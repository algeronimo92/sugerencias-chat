"""Eventos de las notificaciones."""

from __future__ import annotations

from dataclasses import dataclass

from app.core.events import DomainEvent


@dataclass(frozen=True, kw_only=True)
class NotificationsRead(DomainEvent):
    """El usuario marcó notificaciones como leídas: sus otras pestañas
    actualizan la campanita."""

    user_id: int


@dataclass(frozen=True, kw_only=True)
class NotificationCreated(DomainEvent):
    """Una notificación nueva para un usuario: le llega al instante y por
    push si no tiene la app abierta."""

    user_id: int
    notification: dict
    push_title: str
    push_body: str
    push_url: str
    push_tag: str

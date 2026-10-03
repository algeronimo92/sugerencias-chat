"""Eventos propios del motor de automatizaciones.

El motor no avisa a nadie por su cuenta: publica lo que pasó y los
suscriptores (``automations.subscribers``) despiertan al worker, avisan por
WebSocket y crean las notificaciones.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.core.events import DomainEvent


@dataclass(frozen=True, kw_only=True)
class AutomationsChanged(DomainEvent):
    """Cambió alguna regla o el estado de alguna ejecución: los paneles de
    automatizaciones tienen que refrescarse. ``wake`` pide además que el
    worker revise la cola ya, sin esperar a su próximo ciclo."""

    wake: bool = False


@dataclass(frozen=True, kw_only=True)
class AutomationsScheduled(AutomationsChanged):
    """Se agendaron ejecuciones nuevas: hay que despertar al worker y avisar
    a los paneles de automatizaciones, una vez confirmado el commit."""

    count: int
    wake: bool = True


@dataclass(frozen=True, kw_only=True)
class ExecutionFailed(DomainEvent):
    """Una ejecución quedó en failed: el admin que creó la regla se entera
    sin tener que entrar al historial."""

    execution_id: int
    rule_id: int
    rule_name: str
    rule_owner_id: int | None
    lead_id: str | None
    error: str


@dataclass(frozen=True, kw_only=True)
class AutomationMessagesQueued(DomainEvent):
    """Una acción del motor encoló mensajes para el cliente."""

    chat_id: str


@dataclass(frozen=True, kw_only=True)
class AutomationTaskCreated(DomainEvent):
    task_id: int


@dataclass(frozen=True, kw_only=True)
class AutomationNotificationCreated(DomainEvent):
    user_id: int
    notification: dict

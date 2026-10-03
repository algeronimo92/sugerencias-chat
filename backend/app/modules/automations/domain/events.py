"""Eventos propios del motor de automatizaciones."""

from __future__ import annotations

from dataclasses import dataclass

from app.core.events import DomainEvent


@dataclass(frozen=True, kw_only=True)
class AutomationsScheduled(DomainEvent):
    """Se agendaron ejecuciones nuevas: hay que despertar al worker y avisar
    a los paneles de automatizaciones, una vez confirmado el commit."""

    count: int

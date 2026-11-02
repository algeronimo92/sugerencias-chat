"""Eventos de las tareas."""

from __future__ import annotations

from dataclasses import dataclass

from app.core.events import DomainEvent


@dataclass(frozen=True, kw_only=True)
class TasksChanged(DomainEvent):
    """Se creó, editó o completó alguna tarea: las listas tienen que
    refrescarse."""

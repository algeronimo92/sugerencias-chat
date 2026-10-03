"""Eventos de los catálogos que otros módulos necesitan seguir."""

from __future__ import annotations

from dataclasses import dataclass

from app.core.events import DomainEvent


@dataclass(frozen=True, kw_only=True)
class ServiceRenamed(DomainEvent):
    """Un servicio del catálogo cambió de nombre. Los leads y las reglas de
    automatización lo referencian por nombre, así que tienen que seguirlo."""

    service_id: int
    old_name: str
    new_name: str
    actor_user_id: int | None


@dataclass(frozen=True, kw_only=True)
class TemplatesChanged(DomainEvent):
    """Cambiaron las plantillas. ``template_ids`` y ``source`` se informan
    cuando el cambio vino de Meta; ``media_library_affected`` cuando también
    cambió el uso de los recursos de la librería."""

    template_ids: tuple[int, ...] = ()
    source: str | None = None
    media_library_affected: bool = False

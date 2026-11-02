"""Eventos de la librería de medios."""

from __future__ import annotations

from dataclasses import dataclass

from app.core.events import DomainEvent


@dataclass(frozen=True, kw_only=True)
class MediaLibraryChanged(DomainEvent):
    """Cambió la librería de medios. ``templates_affected`` cuando el cambio
    también se ve en los adjuntos de las plantillas (un renombre)."""

    templates_affected: bool = False

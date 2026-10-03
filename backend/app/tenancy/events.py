"""Eventos del plano de control de los negocios."""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from app.core.events import DomainEvent


@dataclass(frozen=True, kw_only=True)
class OrganizationSuspended(DomainEvent):
    """Un negocio quedó suspendido: lo que ya estaba conectado se corta."""

    organization_id: UUID

"""Eventos de la agenda."""

from __future__ import annotations

from dataclasses import dataclass

from app.core.events import DomainEvent


@dataclass(frozen=True, kw_only=True)
class ContactsChanged(DomainEvent):
    """Se creó, editó, enlazó o borró algún contacto: la agenda se relee."""


@dataclass(frozen=True, kw_only=True)
class ContactImportsChanged(DomainEvent):
    """Cambió una importación o la sincronización con el celular: llegaron
    filas nuevas, se confirmó una tanda o Meta respondió el pedido."""

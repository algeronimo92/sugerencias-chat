"""Contexto inmutable del tenant y propagación segura entre capas.

El nombre de schema nunca se construye desde el host ni desde datos enviados por
el cliente. ``TenantContext`` solo acepta el formato opaco generado durante el
aprovisionamiento, de modo que también es seguro usarlo desde workers.
"""

from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar, Token
from dataclasses import dataclass
import re
from typing import Iterator
from uuid import UUID


TENANT_SCHEMA_RE = re.compile(r"^tenant_[0-9a-f]{32}$")


def validate_schema_name(schema_name: str) -> str:
    """Valida el identificador opaco permitido para schemas tenant.

    La lista cerrada hace imposible inyectar comillas, comas u otros elementos
    en ``search_path``. ``public`` se excluye a propósito: es el plano de
    control y solo puede abrirse mediante ``control_session``.
    """

    if not TENANT_SCHEMA_RE.fullmatch(schema_name):
        raise ValueError("invalid tenant schema name")
    return schema_name


@dataclass(frozen=True, slots=True)
class TenantContext:
    organization_id: UUID
    schema_name: str
    hostname: str

    def __post_init__(self) -> None:
        validate_schema_name(self.schema_name)
        if not self.hostname or self.hostname != self.hostname.lower():
            raise ValueError("tenant hostname must be normalized")


_current_tenant: ContextVar[TenantContext | None] = ContextVar(
    "current_tenant", default=None
)


def get_current_tenant() -> TenantContext | None:
    return _current_tenant.get()


def set_current_tenant(context: TenantContext) -> Token[TenantContext | None]:
    return _current_tenant.set(context)


def reset_current_tenant(token: Token[TenantContext | None]) -> None:
    _current_tenant.reset(token)


@contextmanager
def tenant_context(context: TenantContext) -> Iterator[TenantContext]:
    """Propaga el tenant durante una unidad de trabajo no ligada a HTTP."""

    token = set_current_tenant(context)
    try:
        yield context
    finally:
        reset_current_tenant(token)

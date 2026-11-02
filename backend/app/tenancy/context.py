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
import unicodedata
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


STORAGE_SEGMENT_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(-[a-z0-9]+(-[a-z0-9]+)*)?$")
_STORAGE_SLUG_MAX = 40


def _slugify(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    slug = re.sub(r"[^a-z0-9]+", "-", normalized.lower()).strip("-")
    return slug[:_STORAGE_SLUG_MAX].strip("-")


def build_storage_segment(organization_id: UUID, name: str) -> str:
    """Carpeta del negocio en el almacenamiento de objetos.

    Lleva el nombre además del UUID solo para poder reconocer el negocio en la
    consola de MinIO. El UUID va primero y es lo que la hace única: el nombre es
    decorativo y **no** se recalcula nunca, porque la ruta se guarda una sola vez
    (``organizations.storage_prefix``). Si el negocio se renombra, la carpeta
    conserva el nombre viejo y los archivos siguen resolviendo; derivarla del
    nombre actual dejaría huérfano todo lo subido antes del cambio.
    """

    slug = _slugify(name)
    return f"{organization_id}-{slug}" if slug else str(organization_id)


def validate_storage_segment(segment: str) -> str:
    if not STORAGE_SEGMENT_RE.fullmatch(segment):
        raise ValueError("invalid tenant storage segment")
    return segment


@dataclass(frozen=True, slots=True)
class TenantContext:
    organization_id: UUID
    schema_name: str
    hostname: str
    storage_segment: str | None = None

    def __post_init__(self) -> None:
        validate_schema_name(self.schema_name)
        if not self.hostname or self.hostname != self.hostname.lower():
            raise ValueError("tenant hostname must be normalized")
        if self.storage_segment is not None:
            validate_storage_segment(self.storage_segment)

    @property
    def storage_path(self) -> str:
        """Los negocios anteriores a la columna usan el UUID pelado."""
        return self.storage_segment or str(self.organization_id)


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

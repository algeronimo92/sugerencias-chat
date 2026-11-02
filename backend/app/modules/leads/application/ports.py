"""Puertos de salida que necesitan los casos de uso del lead.

La aplicación habla con estas interfaces; la implementación con SQLAlchemy
vive en ``app.modules.leads.infrastructure`` y la conecta
``app.composition.register_adapters``. Los tests usan dobles en memoria.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any, Protocol

from app.modules.leads.domain.lead import Lead, TriggerMessage
from app.modules.leads.domain.stage import StageRule


class LeadRepository(Protocol):
    async def get_for_update(self, lead_id: str, fields: Iterable[str] = ()) -> Lead | None:
        """El lead con su fila bloqueada hasta el fin de la transacción."""

    async def add(self, lead: Lead) -> list[int]:
        """Inserta un lead nuevo con su identidad de WhatsApp. Devuelve los
        ids de auditoría en el orden de ``lead.activities``."""

    async def save(self, lead: Lead) -> list[int]:
        """Persiste ``lead.changes`` y ``lead.activities``; devuelve los ids de
        auditoría en orden."""

    async def delete(self, lead_id: str) -> bool: ...

    async def stage_rules(self, keys: Iterable[str]) -> dict[str, StageRule]: ...

    async def seller_name(self, seller_id: int) -> str | None:
        """Nombre del vendedor activo, o ``None`` si no existe o está inactivo."""

    async def latest_customer_message(self, lead_id: str) -> TriggerMessage | None: ...

    async def replace_phone_identity(self, lead_id: str, new_phone: str) -> None:
        """Cambia el ``wa_id`` del lead. Falla con ``LeadAlreadyExists`` si
        otro lead ya lo usa."""

    async def active_tag(self, tag_id: int) -> dict[str, Any] | None: ...

    async def assigned_tag(self, lead_id: str, tag_id: int) -> dict[str, Any] | None: ...

    async def add_tag(self, lead_id: str, tag_id: int, assigned_by: int | None) -> None: ...

    async def remove_tag(self, lead_id: str, tag_id: int) -> None: ...

    async def open_conversation(self, lead_id: str) -> tuple[int, str | None] | None:
        """Abre la conversación solo si estaba cerrada (atómico frente a dos
        webhooks concurrentes). Devuelve ``(versión, abierta_en)``."""

    async def record_activity(self, lead_id: str, record) -> int: ...

    async def merge(self, source_id: str, target_id: str) -> None: ...

    async def rename_service(self, old_name: str, new_name: str) -> list[str]:
        """Reemplaza el servicio de interés en los leads que lo tenían
        (comparando sin mayúsculas ni espacios). Devuelve los leads tocados."""


_repository: LeadRepository | None = None


def provide_lead_repository(repository: LeadRepository) -> None:
    global _repository
    _repository = repository


def lead_repository() -> LeadRepository:
    if _repository is None:
        raise RuntimeError("No hay un LeadRepository configurado (ver app.composition)")
    return _repository

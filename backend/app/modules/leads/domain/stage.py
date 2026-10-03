"""Semántica de las etapas del embudo al mover un lead.

Las etapas son filas de cada negocio: el código nunca decide por la clave ni
por el nombre visible, sino por ``kind`` (``LeadStageKind``).
"""

from __future__ import annotations

from dataclasses import dataclass

from app.modules.leads.domain.errors import InvalidLeadStageError
from app.modules.leads.domain.types import LeadStageKind


@dataclass(frozen=True)
class StageRule:
    """Lo que el código necesita saber de una etapa al mover un lead."""

    key: str
    kind: str
    is_active: bool

    @property
    def is_lost(self) -> bool:
        return self.kind == LeadStageKind.LOST


def require_destination(rules: dict[str, StageRule], key: str) -> StageRule:
    """La etapa a la que se mueve un lead tiene que existir y estar activa.

    Un lead puede seguir en una etapa que el negocio desactivó, pero nadie
    (usuario, automatización o analista) puede mandarlo a una inactiva o
    inexistente.
    """
    rule = rules.get(key)
    if rule is None:
        raise InvalidLeadStageError(key)
    if not rule.is_active:
        raise InvalidLeadStageError(key, inactive=True)
    return rule

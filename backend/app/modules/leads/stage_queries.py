"""Etapas del embudo: lado de lectura.

Las pantallas, el analista de IA y la validación de automatizaciones leen
las etapas del negocio por acá; los cambios van por ``stages.py``.
"""

from __future__ import annotations

from sqlalchemy import func, select

from app.db.models.leads import Lead, LeadStage
from app.db.uow import session_scope
from app.modules.leads.domain.errors import InvalidLeadStageError
from app.modules.leads.domain.stage import StageRule, require_destination
from app.modules.leads.domain.types import INITIAL_LEAD_STAGE

STAGE_COLUMNS = (
    LeadStage.key,
    LeadStage.name,
    LeadStage.color,
    LeadStage.position,
    LeadStage.kind,
    LeadStage.is_active,
    LeadStage.description,
)


def stage_dict(row) -> dict:
    data = dict(row)
    data["is_system"] = data["key"] == INITIAL_LEAD_STAGE
    return data


async def list_lead_stages(*, include_usage: bool = False) -> list[dict]:
    """Todas las etapas (activas e inactivas) en el orden del embudo.

    Las inactivas viajan igual: el frontend las necesita para rotular los
    leads que siguen en ellas y el historial de cambios.
    """

    async with session_scope() as session:
        rows = (
            await session.execute(
                select(*STAGE_COLUMNS).order_by(LeadStage.position.asc(), LeadStage.key.asc())
            )
        ).mappings().all()
        counts: dict[str, int] = {}
        if include_usage:
            counts = dict(
                (
                    await session.execute(
                        select(Lead.estado, func.count(Lead.id)).group_by(Lead.estado)
                    )
                ).all()
            )
    stages = [stage_dict(row) for row in rows]
    if include_usage:
        for stage in stages:
            stage["lead_count"] = int(counts.get(stage["key"], 0))
    return stages


async def list_stages_for_ai() -> list[dict]:
    """Etapas válidas como destino para el analista IA, en orden del embudo."""

    async with session_scope() as session:
        rows = (
            await session.execute(
                select(LeadStage.key, LeadStage.name, LeadStage.kind, LeadStage.description)
                .where(LeadStage.is_active.is_(True))
                .order_by(LeadStage.position.asc(), LeadStage.key.asc())
            )
        ).mappings().all()
    return [dict(row) for row in rows]


async def stage_problem(keys, *, active_only: bool) -> str | None:
    """Por qué las claves que menciona una automatización no sirven, o None.

    Con ``active_only`` cada clave tiene que ser un destino válido (existe y
    está activa); si no, alcanza con que exista.
    """

    wanted = {key for key in keys if key}
    if not wanted:
        return None
    async with session_scope() as session:
        rows = (
            await session.execute(
                select(LeadStage.key, LeadStage.kind, LeadStage.is_active).where(
                    LeadStage.key.in_(wanted)
                )
            )
        ).all()
    rules = {key: StageRule(key, kind, bool(is_active)) for key, kind, is_active in rows}
    try:
        for key in sorted(wanted):
            if active_only:
                require_destination(rules, key)
            elif key not in rules:
                raise InvalidLeadStageError(key)
    except InvalidLeadStageError as exc:
        return str(exc)
    return None

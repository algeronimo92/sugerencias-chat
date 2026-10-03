"""Etapas del embudo administradas por cada negocio (``lead_stages``).

La tabla vive en el schema del tenant, así que todo lo de acá lee y escribe
las etapas del negocio de la request actual sin filtrar por organización.

Reglas que protege este módulo (además de las constraints de la base):

- La clave (``key``) nace del nombre al crear la etapa y no cambia nunca:
  renombrar solo toca ``name``. Así ``leads.estado``, las automatizaciones,
  las plantillas y el historial no se reescriben.
- Una etapa en uso no se borra (leads, automatizaciones o plantillas que la
  nombran): se desactiva. Desactivada deja de ofrecerse como destino, pero
  los leads que ya están en ella se quedan ahí.
- La etapa inicial (``INITIAL_LEAD_STAGE``) no se borra, no se desactiva y
  es siempre abierta: todo lead nuevo entra por ella.
"""

from __future__ import annotations

import re
import unicodedata
from datetime import datetime, timezone

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError

from app.modules.leads.domain.errors import (
    InvalidLeadStageError,
    LeadStageConflictError,
    LeadStageInUseError,
    LeadStageNotFoundError,
    LeadStageProtectedError,
)
from app.modules.leads.domain.stage import StageRule, require_destination
from app.db.models.automations import AutomationRule
from app.db.models.leads import Lead, LeadStage
from app.db.models.catalogs import MessageTemplate
from domain_types import INITIAL_LEAD_STAGE, LeadStageKind
from app.db.uow import session_scope


MAX_STAGES = 40
_KEY_MAX_LENGTH = 40


_COLUMNS = (
    LeadStage.key,
    LeadStage.name,
    LeadStage.color,
    LeadStage.position,
    LeadStage.kind,
    LeadStage.is_active,
    LeadStage.description,
)


def _stage_dict(row) -> dict:
    data = dict(row)
    data["is_system"] = data["key"] == INITIAL_LEAD_STAGE
    return data


def slugify_stage_key(name: str) -> str:
    """Clave estable a partir del nombre visible: "Cita pagada" -> cita_pagada."""

    ascii_name = (
        unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii")
    )
    slug = re.sub(r"[^a-z0-9]+", "_", ascii_name.lower()).strip("_")
    if not slug or not slug[0].isalpha():
        slug = f"etapa_{slug}".rstrip("_")
    return slug[:_KEY_MAX_LENGTH].rstrip("_")


def _unique_key(base: str, taken: set[str]) -> str:
    if base not in taken:
        return base
    suffix = 2
    while True:
        tail = f"_{suffix}"
        candidate = f"{base[:_KEY_MAX_LENGTH - len(tail)].rstrip('_')}{tail}"
        if candidate not in taken:
            return candidate
        suffix += 1


async def list_lead_stages(*, include_usage: bool = False) -> list[dict]:
    """Todas las etapas (activas e inactivas) en el orden del embudo.

    Las inactivas viajan igual: el frontend las necesita para rotular los
    leads que siguen en ellas y el historial de cambios.
    """

    async with session_scope() as session:
        rows = (
            await session.execute(
                select(*_COLUMNS).order_by(LeadStage.position.asc(), LeadStage.key.asc())
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
    stages = [_stage_dict(row) for row in rows]
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


async def load_stage_rules(session, keys) -> dict[str, StageRule]:
    """Tipo y estado de las etapas pedidas, en la sesión del llamador (para
    validar dentro de la misma transacción que mueve el lead)."""

    wanted = {key for key in keys if key}
    if not wanted:
        return {}
    rows = (
        await session.execute(
            select(LeadStage.key, LeadStage.kind, LeadStage.is_active).where(
                LeadStage.key.in_(wanted)
            )
        )
    ).all()
    return {key: StageRule(key, kind, bool(is_active)) for key, kind, is_active in rows}


async def verify_stage_keys(session, keys, *, active_only: bool) -> None:
    """Valida claves mencionadas por automatizaciones antes de guardarlas."""

    wanted = {key for key in keys if key}
    if not wanted:
        return
    rules = await load_stage_rules(session, wanted)
    for key in sorted(wanted):
        if active_only:
            require_destination(rules, key)
        elif key not in rules:
            raise InvalidLeadStageError(key)


def _mentions_stage(value, key: str) -> bool:
    """¿El JSON de una automatización nombra la etapa?

    Cubre las tres formas en que hoy se guarda una etapa: la condición
    ``conditions.stage``, la acción ``change_stage`` (``{"stage": ...}``) y la
    condición de flujo ``stage_equals`` (``{"condition_type", "value"}``).
    """

    if isinstance(value, list):
        return any(_mentions_stage(item, key) for item in value)
    if not isinstance(value, dict):
        return False
    if value.get("stage") == key:
        return True
    if value.get("condition_type") == "stage_equals" and value.get("value") == key:
        return True
    return any(_mentions_stage(item, key) for item in value.values())


async def stage_usage(session, key: str) -> dict[str, int]:
    leads = int(
        await session.scalar(select(func.count(Lead.id)).where(Lead.estado == key)) or 0
    )
    templates = int(
        await session.scalar(
            select(func.count(MessageTemplate.id)).where(MessageTemplate.stage == key)
        )
        or 0
    )
    rules = (
        await session.execute(
            select(
                AutomationRule.conditions,
                AutomationRule.actions,
                AutomationRule.flow_definition,
                AutomationRule.published_flow_definition,
            ).where(AutomationRule.deleted_at.is_(None))
        )
    ).all()
    automations = sum(1 for row in rules if _mentions_stage(list(row), key))
    return {"leads": leads, "automations": automations, "templates": templates}


def _describe_usage(usage: dict[str, int]) -> str:
    parts = []
    if usage["leads"]:
        parts.append(f"{usage['leads']} lead{'s' if usage['leads'] != 1 else ''}")
    if usage["automations"]:
        count = usage["automations"]
        parts.append(f"{count} automatizaci{'ones' if count != 1 else 'ón'}")
    if usage["templates"]:
        parts.append(f"{usage['templates']} plantilla{'s' if usage['templates'] != 1 else ''}")
    return ", ".join(parts)


async def create_lead_stage(values: dict) -> dict:
    name = values["name"]
    async with session_scope() as session:
        existing = (
            await session.execute(select(LeadStage.key, LeadStage.name, LeadStage.position))
        ).all()
        if len(existing) >= MAX_STAGES:
            raise LeadStageConflictError(f"Un embudo admite hasta {MAX_STAGES} etapas")
        if any(row.name.casefold() == name.casefold() for row in existing):
            raise LeadStageConflictError("Ya existe una etapa con ese nombre")
        key = _unique_key(slugify_stage_key(name), {row.key for row in existing})
        position = max((row.position for row in existing), default=-1) + 1
        stage = LeadStage(
            key=key,
            name=name,
            color=values["color"],
            position=position,
            kind=values.get("kind") or LeadStageKind.OPEN,
            is_active=True,
            description=values.get("description"),
        )
        session.add(stage)
        try:
            await session.flush()
        except IntegrityError as exc:
            await session.rollback()
            raise LeadStageConflictError("Ya existe una etapa con ese nombre") from exc
        row = (
            await session.execute(select(*_COLUMNS).where(LeadStage.key == key))
        ).mappings().one()
    return _stage_dict(row)


async def update_lead_stage_definition(key: str, values: dict) -> dict:
    """Renombra, recolorea, cambia el tipo o activa/desactiva una etapa."""

    if key == INITIAL_LEAD_STAGE:
        if values.get("is_active") is False:
            raise LeadStageProtectedError(
                "La etapa inicial no se puede desactivar: todo lead nuevo entra por ella"
            )
        if values.get("kind") not in (None, LeadStageKind.OPEN):
            raise LeadStageProtectedError("La etapa inicial tiene que ser una etapa abierta")
    async with session_scope() as session:
        stage = await session.get(LeadStage, key, with_for_update=True)
        if stage is None:
            raise LeadStageNotFoundError("Etapa no encontrada")
        if "name" in values and values["name"].casefold() != stage.name.casefold():
            clash = await session.scalar(
                select(LeadStage.key).where(
                    func.lower(LeadStage.name) == values["name"].casefold(),
                    LeadStage.key != key,
                )
            )
            if clash is not None:
                raise LeadStageConflictError("Ya existe una etapa con ese nombre")
        for field in ("name", "color", "kind", "is_active", "description"):
            if field in values:
                setattr(stage, field, values[field])
        stage.updated_at = datetime.now(timezone.utc)
        try:
            await session.flush()
        except IntegrityError as exc:
            await session.rollback()
            raise LeadStageConflictError("Ya existe una etapa con ese nombre") from exc
        row = (
            await session.execute(select(*_COLUMNS).where(LeadStage.key == key))
        ).mappings().one()
    return _stage_dict(row)


async def reorder_lead_stages(keys: list[str]) -> list[dict]:
    """Fija el orden del embudo. Exige la lista completa de claves para que
    dos pantallas abiertas no dejen posiciones repetidas o huecos."""

    async with session_scope() as session:
        current = set(
            (await session.execute(select(LeadStage.key).with_for_update())).scalars().all()
        )
        if len(keys) != len(set(keys)) or set(keys) != current:
            raise LeadStageConflictError(
                "El orden debe incluir todas las etapas una sola vez; recarga la página"
            )
        now = datetime.now(timezone.utc)
        for position, key in enumerate(keys):
            await session.execute(
                update(LeadStage)
                .where(LeadStage.key == key, LeadStage.position != position)
                .values(position=position, updated_at=now)
            )
        await session.flush()
    return await list_lead_stages(include_usage=True)


async def delete_lead_stage(key: str) -> None:
    if key == INITIAL_LEAD_STAGE:
        raise LeadStageProtectedError("La etapa inicial no se puede eliminar")
    async with session_scope() as session:
        stage = await session.get(LeadStage, key, with_for_update=True)
        if stage is None:
            raise LeadStageNotFoundError("Etapa no encontrada")
        usage = await stage_usage(session, key)
        if any(usage.values()):
            raise LeadStageInUseError(
                f"La etapa está en uso ({_describe_usage(usage)}). Desactívala en lugar de eliminarla."
            )
        await session.delete(stage)
        try:
            await session.flush()
        except IntegrityError as exc:
            # Un lead entró a la etapa entre la verificación y el borrado: la
            # FK de leads.estado lo frena.
            await session.rollback()
            raise LeadStageInUseError(
                "La etapa está en uso. Desactívala en lugar de eliminarla."
            ) from exc

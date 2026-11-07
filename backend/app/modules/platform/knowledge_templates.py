"""Biblioteca de plantillas de conocimiento que administra la plataforma.

El operador las escribe una vez (ficha del Hollywood Peel, preguntas
frecuentes de láser...) y cada negocio las importa como copia propia desde
Asistente IA › Conocimiento. Editar una plantilla sube su ``version`` y no
toca las copias ya importadas: cada versión importada es del negocio.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select

from app.db.models.control import KnowledgeTemplate
from app.db.session import control_session


def _item(template: KnowledgeTemplate) -> dict:
    return {
        "id": template.id,
        "title": template.title,
        "document_type": template.document_type,
        "service_hint": template.service_hint,
        "content": template.content,
        "is_active": template.is_active,
        "version": template.version,
        "updated_at": template.updated_at.isoformat().replace("+00:00", "Z"),
    }


async def list_templates(*, include_inactive: bool = False) -> list[dict]:
    stmt = select(KnowledgeTemplate).order_by(KnowledgeTemplate.service_hint.nulls_last(), KnowledgeTemplate.title)
    if not include_inactive:
        stmt = stmt.where(KnowledgeTemplate.is_active.is_(True))
    async with control_session() as session:
        rows = (await session.execute(stmt)).scalars().all()
    return [_item(row) for row in rows]


async def get_active_template(template_id: int) -> dict | None:
    async with control_session() as session:
        template = await session.get(KnowledgeTemplate, template_id)
    if template is None or not template.is_active:
        return None
    return _item(template)


def _clean(values: dict) -> dict:
    cleaned = dict(values)
    for key in ("title", "service_hint"):
        if key in cleaned and cleaned[key] is not None:
            cleaned[key] = " ".join(cleaned[key].split()) or None
    if "content" in cleaned and cleaned["content"] is not None:
        cleaned["content"] = cleaned["content"].replace("\r\n", "\n").strip()
    if cleaned.get("document_type") == "":
        cleaned["document_type"] = None
    if "title" in cleaned and not cleaned["title"]:
        raise ValueError("El título es obligatorio")
    if "content" in cleaned and not cleaned["content"]:
        raise ValueError("La plantilla no tiene texto")
    return cleaned


async def create_template(values: dict) -> dict:
    values = _clean(values)
    async with control_session() as session:
        template = KnowledgeTemplate(**values)
        session.add(template)
        await session.flush()
        await session.refresh(template)
        return _item(template)


async def update_template(template_id: int, values: dict) -> dict | None:
    values = _clean(values)
    async with control_session() as session:
        template = await session.get(KnowledgeTemplate, template_id, with_for_update=True)
        if template is None:
            return None
        content_changed = any(
            key in values and values[key] != getattr(template, key)
            for key in ("title", "content", "document_type", "service_hint")
        )
        for key, value in values.items():
            setattr(template, key, value)
        if content_changed:
            template.version += 1
            template.updated_at = datetime.now(timezone.utc)
        await session.flush()
        return _item(template)

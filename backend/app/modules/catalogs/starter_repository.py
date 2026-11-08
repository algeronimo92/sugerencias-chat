"""Siembra del paquete inicial de un negocio y su lectura para el checklist.

Todo es aditivo: cada fila entra con ``ON CONFLICT DO NOTHING`` contra los
índices únicos que ya existen (nombre de etiqueta y de categoría, atajo de
plantilla global). Correrlo de nuevo, o sobre un negocio que ya cargó lo suyo,
no pisa ni duplica nada: lo que ya está gana.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import func, or_, select, true
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.db.models.catalogs import LeadService, LeadTag, MessageTemplate, ServicePackage, TemplateCategory
from app.db.uow import collect, current_session, session_scope, unit_of_work
from app.modules.catalogs.events import TemplatesChanged
from app.modules.catalogs.template_validation import validate_template_values


async def _internal_template_values(raw: dict) -> dict:
    values = {
        "name": raw["name"],
        "content": raw["content"],
        "shortcut": raw.get("shortcut"),
        "category": raw.get("category") or "General",
        "stage": None,
        "task_type": None,
        "service": None,
        "is_active": True,
        "template_type": "internal",
        "interactive_type": "none",
        "interactive_config": {},
    }
    # La misma normalización que el formulario: atajo en minúsculas sin "/",
    # variables permitidas y largo máximo. Un paquete mal escrito falla acá y
    # no a mitad de la transacción.
    return await validate_template_values(values)


async def seed_starter_catalog(
    *,
    tags: list[dict],
    categories: list[str],
    templates: list[dict],
    user_id: int | None,
) -> dict[str, int]:
    """Agrega etiquetas, categorías y plantillas internas que falten.

    Sin ``user_id`` (un negocio dado de alta sin admin) las plantillas se
    omiten: ``message_templates.created_by_user_id`` es obligatorio. Se
    pueden sembrar después, a demanda, cuando ya exista el admin.
    """

    prepared = [await _internal_template_values(dict(raw)) for raw in templates] if user_id else []
    now = datetime.now(timezone.utc)
    created = {"tags": 0, "categories": 0, "templates": 0}
    async with unit_of_work():
        session = current_session()
        for tag in tags:
            result = await session.execute(
                pg_insert(LeadTag)
                .values(name=tag["name"], color=tag["color"], is_active=True, created_at=now)
                .on_conflict_do_nothing()
            )
            created["tags"] += result.rowcount or 0
        for name in categories:
            result = await session.execute(
                pg_insert(TemplateCategory)
                .values(name=name, is_active=True, created_at=now)
                .on_conflict_do_nothing()
            )
            created["categories"] += result.rowcount or 0
        for values in prepared:
            result = await session.execute(
                pg_insert(MessageTemplate)
                .values(
                    **values,
                    visibility="global",
                    created_by_user_id=user_id,
                    created_at=now,
                    updated_at=now,
                )
                .on_conflict_do_nothing()
            )
            created["templates"] += result.rowcount or 0
        if created["templates"]:
            collect(TemplatesChanged())
    return created


async def onboarding_catalog_status(starter_shortcuts: frozenset[str]) -> dict:
    """Lo que el checklist necesita de los catálogos.

    - ``priced_services``: servicios activos con al menos un paquete activo; es
      lo que el asistente IA usa para cotizar, así que un servicio sin paquetes
      no cuenta.
    - ``templates_customized``: el admin ya tocó las plantillas (editó una,
      o tiene alguna global que no vino en el paquete).
    """

    async with session_scope() as session:
        priced_services = (
            await session.execute(
                select(func.count(func.distinct(ServicePackage.service_id)))
                .select_from(ServicePackage)
                .join(LeadService, LeadService.id == ServicePackage.service_id)
                .where(LeadService.is_active == true(), ServicePackage.is_active == true())
            )
        ).scalar_one()
        customized = (
            await session.execute(
                select(func.count(MessageTemplate.id)).where(
                    MessageTemplate.visibility == "global",
                    or_(
                        MessageTemplate.updated_at > MessageTemplate.created_at,
                        MessageTemplate.shortcut.is_(None),
                        func.lower(MessageTemplate.shortcut).not_in(sorted(starter_shortcuts))
                        if starter_shortcuts
                        else true(),
                    ),
                )
            )
        ).scalar_one()
    return {"priced_services": int(priced_services), "templates_customized": bool(customized)}

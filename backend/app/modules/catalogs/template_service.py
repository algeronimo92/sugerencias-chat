"""Comandos de plantillas. Cada uno corre en su unidad de trabajo y avisa
con ``TemplatesChanged`` una vez confirmado; los que tocan adjuntos o borran
una plantilla también refrescan la librería de medios, que muestra en qué
plantillas se usa cada recurso. Las lecturas viven en template_queries.py."""

from __future__ import annotations

from app.db.uow import collect, unit_of_work
from app.modules.catalogs import template_repository
from app.modules.catalogs.events import TemplatesChanged
from app.modules.catalogs.template_queries import list_templates

__all__ = [
    "add_template_attachment",
    "create_personal_template",
    "create_template",
    "delete_template",
    "list_templates",
    "record_template_use",
    "remove_template_attachment",
    "replace_official_template_from_meta",
    "set_template_favorite",
    "update_template",
]


async def create_template(values: dict, user_id: int):
    async with unit_of_work():
        item = await template_repository.create_template(values, user_id)
        collect(TemplatesChanged())
    return item


async def create_personal_template(name: str, content: str, shortcut: str | None, user_id: int):
    return await create_template(
        {"name": name, "content": content, "shortcut": shortcut, "category": "personal", "stage": None,
         "task_type": None, "service": None, "is_active": True, "visibility": "personal",
         "template_type": "internal", "official_parameter_values": [],
         "interactive_type": "none", "interactive_config": {}},
        user_id,
    )


async def update_template(template_id: int, values: dict):
    async with unit_of_work():
        item = await template_repository.update_template(template_id, values)
        if item is not None:
            collect(TemplatesChanged())
    return item


async def replace_official_template_from_meta(
    meta_template_id: str, remote: dict, *, source: str | None = None,
) -> list[int]:
    """Copia el estado completo que informa Meta en las plantillas locales
    vinculadas. ``source`` dice de dónde vino el cambio (el webhook o una
    sincronización a mano)."""
    async with unit_of_work():
        template_ids = await template_repository.replace_official_template_from_meta(meta_template_id, remote)
        if template_ids:
            collect(TemplatesChanged(template_ids=tuple(template_ids), source=source))
    return template_ids


async def delete_template(template_id: int) -> dict | None:
    async with unit_of_work():
        deleted = await template_repository.delete_template(template_id)
        if deleted is not None:
            collect(TemplatesChanged(media_library_affected=True))
    return deleted


async def set_template_favorite(template_id: int, user_id: int, is_favorite: bool) -> bool:
    async with unit_of_work():
        return await template_repository.set_template_favorite(template_id, user_id, is_favorite)


async def record_template_use(template_id: int, user_id: int) -> bool:
    async with unit_of_work():
        return await template_repository.record_template_use(template_id, user_id)


async def add_template_attachment(
    template_id: int, media_url: str, content_type: str, filename: str, library_asset_id: int | None = None,
) -> dict | None:
    async with unit_of_work():
        item = await template_repository.add_template_attachment(
            template_id, media_url, content_type, filename, library_asset_id,
        )
        if item is not None:
            collect(TemplatesChanged(media_library_affected=True))
    return item


async def remove_template_attachment(attachment_id: int) -> dict | None:
    async with unit_of_work():
        removed = await template_repository.remove_template_attachment(attachment_id)
        if removed is not None:
            collect(TemplatesChanged(media_library_affected=True))
    return removed

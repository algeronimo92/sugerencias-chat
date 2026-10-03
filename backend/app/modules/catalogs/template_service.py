from app.modules.catalogs import template_repository
from app.modules.catalogs.template_policies import (_meta_managed_template_values, _references_template, _template)
"""Plantillas de mensaje: catálogo, favoritos, uso y adjuntos."""

from datetime import datetime, timezone
from app.modules.automations.ports.types import AutomationExecutionStatus
from app.db.models.automations import AutomationExecution, AutomationFlowVersion, AutomationRule
from app.db.models.media import MediaAsset
from app.db.models.catalogs import MessageTemplate, TemplateAttachment, TemplateUserState
from app.db.models.auth import User
from app.core.time_format import iso_utc


async def list_templates(user_id: int, include_inactive=False):
    return await template_repository.list_templates(user_id, include_inactive)


async def create_template(values: dict, user_id: int):
    return await template_repository.create_template(values, user_id)


async def update_template(template_id: int, values: dict):
    return await template_repository.update_template(template_id, values)


async def replace_official_template_from_meta(meta_template_id: str, remote: dict) -> list[int]:
    return await template_repository.replace_official_template_from_meta(meta_template_id, remote)


async def delete_template(template_id: int) -> dict | None:
    return await template_repository.delete_template(template_id)


async def create_personal_template(name: str, content: str, shortcut: str | None, user_id: int):
    return await create_template(
        {"name": name, "content": content, "shortcut": shortcut, "category": "personal", "stage": None,
         "task_type": None, "service": None, "is_active": True, "visibility": "personal",
         "template_type": "internal", "official_parameter_values": [],
         "interactive_type": "none", "interactive_config": {}},
        user_id,
    )


async def _visible_template(session, template_id: int, user_id: int):
    return await template_repository._visible_template(session, template_id, user_id)


async def set_template_favorite(template_id: int, user_id: int, is_favorite: bool) -> bool:
    return await template_repository.set_template_favorite(template_id, user_id, is_favorite)


async def record_template_use(template_id: int, user_id: int) -> bool:
    return await template_repository.record_template_use(template_id, user_id)


async def add_template_attachment(template_id: int, media_url: str, content_type: str, filename: str, library_asset_id: int | None=None) -> dict | None:
    return await template_repository.add_template_attachment(template_id, media_url, content_type, filename, library_asset_id)


async def remove_template_attachment(attachment_id: int) -> dict | None:
    return await template_repository.remove_template_attachment(attachment_id)

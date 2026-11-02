"""Lado de lectura de las plantillas."""

from __future__ import annotations
from sqlalchemy import and_, or_, select
from app.db.models.media import MediaAsset
from app.db.models.catalogs import MessageTemplate, TemplateAttachment, TemplateUserState
from app.db.models.auth import User
from app.modules.catalogs.template_policies import _template
from app.db.uow import session_scope


async def list_templates(user_id: int, include_inactive=False):
    stmt = (
        select(
            MessageTemplate.id, MessageTemplate.name, MessageTemplate.content, MessageTemplate.shortcut,
            MessageTemplate.category, MessageTemplate.stage, MessageTemplate.task_type,
            MessageTemplate.service, MessageTemplate.is_active, MessageTemplate.visibility,
            MessageTemplate.template_type, MessageTemplate.official_name,
            MessageTemplate.official_language, MessageTemplate.official_category,
            MessageTemplate.official_status, MessageTemplate.official_rejected_reason,
            MessageTemplate.official_parameter_values,
            MessageTemplate.meta_template_id, MessageTemplate.official_header_type,
            MessageTemplate.official_header_text, MessageTemplate.official_header_media_asset_id,
            MediaAsset.media_url.label("official_header_media_url"),
            MediaAsset.content_type.label("official_header_media_content_type"),
            MediaAsset.filename.label("official_header_media_filename"),
            MessageTemplate.official_footer,
            MessageTemplate.official_buttons,
            MessageTemplate.interactive_type, MessageTemplate.interactive_config,
            MessageTemplate.imported_from_meta,
            MessageTemplate.created_by_user_id, User.name.label("created_by_name"),
            MessageTemplate.created_at,
            TemplateUserState.is_favorite, TemplateUserState.last_used_at, TemplateUserState.use_count,
        )
        .outerjoin(
            TemplateUserState,
            and_(TemplateUserState.template_id == MessageTemplate.id, TemplateUserState.user_id == user_id),
        )
        .outerjoin(MediaAsset, MediaAsset.id == MessageTemplate.official_header_media_asset_id)
        .join(User, User.id == MessageTemplate.created_by_user_id)
        .where(or_(MessageTemplate.visibility == "global", MessageTemplate.created_by_user_id == user_id))
        .order_by(TemplateUserState.is_favorite.desc().nullslast(), TemplateUserState.last_used_at.desc().nullslast(), MessageTemplate.name)
    )
    if not include_inactive:
        stmt = stmt.where(MessageTemplate.is_active.is_(True))
    async with session_scope() as session:
        rows = (await session.execute(stmt)).mappings().all()
        template_ids = [row["id"] for row in rows]
        attachment_rows = (await session.execute(
            select(TemplateAttachment).where(TemplateAttachment.template_id.in_(template_ids))
            .order_by(TemplateAttachment.template_id, TemplateAttachment.position, TemplateAttachment.id)
        )).scalars().all() if template_ids else []
    attachments: dict[int, list[dict]] = {}
    for item in attachment_rows:
        attachments.setdefault(item.template_id, []).append({
            "id": item.id, "media_url": item.media_url, "content_type": item.content_type,
            "filename": item.filename, "position": item.position,
            "library_asset_id": item.library_asset_id,
        })
    return [_template(row, attachments.get(row["id"])) for row in rows]


async def fetch_template_for_delivery(template_id: int) -> dict | None:
    """La plantilla con sus adjuntos en orden, lista para armar el envío."""
    async with session_scope() as session:
        template = await session.get(MessageTemplate, template_id)
        if template is None:
            return None
        attachments = (await session.execute(
            select(TemplateAttachment).where(TemplateAttachment.template_id == template_id)
            .order_by(TemplateAttachment.position, TemplateAttachment.id)
        )).scalars().all()
    return {
        "id": template.id,
        "content": template.content,
        "is_active": template.is_active,
        "template_type": template.template_type,
        "interactive_type": template.interactive_type,
        "attachments": [
            {
                "id": attachment.id,
                "media_url": attachment.media_url,
                "content_type": attachment.content_type,
                "filename": attachment.filename,
            }
            for attachment in attachments
        ],
    }

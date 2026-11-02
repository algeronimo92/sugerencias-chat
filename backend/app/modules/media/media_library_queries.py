"""Lado de lectura de la librería de medios."""

from __future__ import annotations

from sqlalchemy import and_, func, or_, select

from app.db.models.auth import User
from app.db.models.catalogs import TemplateAttachment
from app.db.models.media import MediaAsset
from app.db.uow import session_scope
from app.modules.media.media_library_policies import _asset


def _asset_query():
    return (
        select(
            MediaAsset.id,
            MediaAsset.media_url,
            MediaAsset.content_type,
            MediaAsset.filename,
            MediaAsset.size_bytes,
            MediaAsset.uploaded_by_user_id,
            User.name.label("uploaded_by_name"),
            MediaAsset.created_at,
            MediaAsset.ai_description,
            func.count(TemplateAttachment.id).label("use_count"),
        )
        .outerjoin(User, User.id == MediaAsset.uploaded_by_user_id)
        .outerjoin(TemplateAttachment, TemplateAttachment.library_asset_id == MediaAsset.id)
        .group_by(MediaAsset.id, User.name)
    )

async def list_media_assets(search: str | None = None, kind: str | None = None) -> list[dict]:
    stmt = _asset_query()
    if search:
        pattern = f"%{search.strip()}%"
        stmt = stmt.where(or_(MediaAsset.filename.ilike(pattern), MediaAsset.content_type.ilike(pattern)))
    if kind == "image":
        stmt = stmt.where(MediaAsset.content_type.startswith("image/"))
    elif kind == "video":
        stmt = stmt.where(MediaAsset.content_type.startswith("video/"))
    elif kind == "audio":
        stmt = stmt.where(MediaAsset.content_type.startswith("audio/"))
    elif kind == "document":
        stmt = stmt.where(and_(
            ~MediaAsset.content_type.startswith("image/"),
            ~MediaAsset.content_type.startswith("video/"),
            ~MediaAsset.content_type.startswith("audio/"),
        ))
    stmt = stmt.order_by(MediaAsset.created_at.desc(), MediaAsset.id.desc()).limit(500)
    async with session_scope() as session:
        rows = (await session.execute(stmt)).mappings().all()
    return [_asset(row) for row in rows]

async def get_media_asset(asset_id: int) -> dict | None:
    async with session_scope() as session:
        row = (await session.execute(_asset_query().where(MediaAsset.id == asset_id))).mappings().one_or_none()
    return _asset(row) if row else None

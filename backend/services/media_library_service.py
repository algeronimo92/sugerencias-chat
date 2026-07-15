from datetime import datetime, timezone

from sqlalchemy import and_, delete, func, insert, or_, select

from db.models import MediaAsset, TemplateAttachment, User
from db.session import get_sessionmaker


def _asset(row) -> dict:
    created_at = row["created_at"]
    return {
        "id": row["id"],
        "media_url": row["media_url"],
        "content_type": row["content_type"],
        "filename": row["filename"],
        "size_bytes": int(row["size_bytes"] or 0),
        "uploaded_by_user_id": row["uploaded_by_user_id"],
        "uploaded_by_name": row["uploaded_by_name"],
        "created_at": created_at.isoformat().replace("+00:00", "Z"),
        "use_count": int(row["use_count"] or 0),
    }


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
    async with get_sessionmaker()() as session:
        rows = (await session.execute(stmt)).mappings().all()
    return [_asset(row) for row in rows]


async def get_media_asset(asset_id: int) -> dict | None:
    async with get_sessionmaker()() as session:
        row = (await session.execute(_asset_query().where(MediaAsset.id == asset_id))).mappings().one_or_none()
    return _asset(row) if row else None


async def create_media_asset(
    media_url: str,
    content_type: str,
    filename: str,
    size_bytes: int,
    uploaded_by_user_id: int | None,
) -> dict:
    async with get_sessionmaker()() as session:
        result = await session.execute(
            insert(MediaAsset)
            .values(
                media_url=media_url,
                content_type=content_type,
                filename=filename,
                size_bytes=size_bytes,
                uploaded_by_user_id=uploaded_by_user_id,
                created_at=datetime.now(timezone.utc),
            )
            .returning(MediaAsset.id)
        )
        asset_id = result.scalar_one()
        await session.commit()
    asset = await get_media_asset(asset_id)
    if asset is None:
        raise RuntimeError("No se pudo recuperar el archivo creado")
    return asset


async def delete_media_asset(asset_id: int) -> str | None:
    async with get_sessionmaker()() as session:
        row = (await session.execute(
            select(
                MediaAsset.media_url,
                func.count(TemplateAttachment.id).label("use_count"),
            )
            .outerjoin(TemplateAttachment, TemplateAttachment.library_asset_id == MediaAsset.id)
            .where(MediaAsset.id == asset_id)
            .group_by(MediaAsset.id)
        )).mappings().one_or_none()
        if row is None:
            return None
        if row["use_count"]:
            raise ValueError(f"El archivo está usado en {row['use_count']} plantilla(s)")
        await session.execute(delete(MediaAsset).where(MediaAsset.id == asset_id))
        await session.commit()
    return row["media_url"]

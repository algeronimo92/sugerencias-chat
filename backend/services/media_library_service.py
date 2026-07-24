from collections.abc import Awaitable, Callable
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import and_, delete, func, insert, or_, select, update

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


def validated_media_filename(filename: str, current_filename: str) -> str:
    normalized = filename.strip()
    if not normalized or len(normalized) > 255:
        raise ValueError("El nombre debe tener entre 1 y 255 caracteres")
    if normalized in {".", ".."} or "/" in normalized or "\\" in normalized:
        raise ValueError("El nombre no puede contener rutas")
    if any(ord(character) < 32 for character in normalized):
        raise ValueError("El nombre contiene caracteres no permitidos")
    if Path(normalized).suffix.lower() != Path(current_filename).suffix.lower():
        raise ValueError("Conserva la extensión original del archivo")
    return normalized


async def rename_media_asset(asset_id: int, filename: str) -> dict | None:
    """Renombra el metadato sin mover el objeto de MinIO ni cambiar su URL."""
    async with get_sessionmaker()() as session:
        asset = (await session.execute(
            select(MediaAsset).where(MediaAsset.id == asset_id).with_for_update()
        )).scalar_one_or_none()
        if asset is None:
            return None
        normalized = validated_media_filename(filename, asset.filename)
        await session.execute(update(MediaAsset).where(
            MediaAsset.id == asset_id
        ).values(filename=normalized))
        await session.execute(update(TemplateAttachment).where(
            TemplateAttachment.library_asset_id == asset_id
        ).values(filename=normalized))
        await session.commit()
    return await get_media_asset(asset_id)


async def delete_media_asset(
    asset_id: int,
    *,
    before_delete: Callable[[str], Awaitable[None]] | None = None,
) -> str | None:
    """Elimina un archivo sin dejar base de datos y almacenamiento desincronizados.

    El registro se bloquea mientras se valida su uso. Cuando se proporciona
    ``before_delete``, el objeto físico se elimina antes de confirmar la
    transacción; si esa operación falla, el registro permanece intacto.
    """
    async with get_sessionmaker()() as session:
        media_url = (await session.execute(
            select(MediaAsset.media_url)
            .where(MediaAsset.id == asset_id)
            .with_for_update()
        )).scalar_one_or_none()
        if media_url is None:
            return None

        use_count = int(await session.scalar(
            select(func.count(TemplateAttachment.id))
            .where(TemplateAttachment.library_asset_id == asset_id)
        ) or 0)
        if use_count:
            raise ValueError(f"El archivo está usado en {use_count} plantilla(s)")

        if before_delete is not None:
            await before_delete(media_url)
        await session.execute(delete(MediaAsset).where(MediaAsset.id == asset_id))
        await session.commit()
    return media_url

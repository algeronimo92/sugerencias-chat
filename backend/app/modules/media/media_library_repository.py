"""Escrituras de la librería de medios. Las lecturas viven en
media_library_queries.py."""
from __future__ import annotations
from collections.abc import Awaitable, Callable
from datetime import datetime, timezone
from sqlalchemy import delete, func, insert, select, update
from app.db.models.media import MediaAsset
from app.db.models.catalogs import TemplateAttachment
from app.modules.media.media_library_policies import validated_media_filename
from app.db.uow import session_scope
from app.modules.media.media_library_queries import get_media_asset

async def create_media_asset(
    media_url: str,
    content_type: str,
    filename: str,
    size_bytes: int,
    uploaded_by_user_id: int | None,
) -> dict:
    async with session_scope() as session:
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
        await session.flush()
    asset = await get_media_asset(asset_id)
    if asset is None:
        raise RuntimeError("No se pudo recuperar el archivo creado")
    return asset

async def rename_media_asset(asset_id: int, filename: str) -> dict | None:
    """Renombra el metadato sin mover el objeto de MinIO ni cambiar su URL."""
    async with session_scope() as session:
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
        await session.flush()
    return await get_media_asset(asset_id)

async def set_media_asset_ai_description(asset_id: int, description: str | None) -> dict | None:
    """Con descripción el asistente IA puede proponer el archivo como adjunto;
    ``None`` o vacío lo saca de sus recursos."""
    normalized = " ".join((description or "").split()) or None
    async with session_scope() as session:
        result = await session.execute(
            update(MediaAsset)
            .where(MediaAsset.id == asset_id)
            .values(ai_description=normalized)
            .returning(MediaAsset.id)
        )
        if result.scalar_one_or_none() is None:
            return None
        await session.flush()
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
    async with session_scope() as session:
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
        await session.flush()
    return media_url

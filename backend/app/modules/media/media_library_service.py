"""Comandos de la librería de medios. Cada uno corre en su unidad de trabajo
y avisa con ``MediaLibraryChanged`` una vez confirmado. Las lecturas viven en
media_library_queries.py."""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from app.db.uow import collect, unit_of_work
from app.modules.media import media_library_repository
from app.modules.media.events import MediaLibraryChanged
from app.modules.media.media_library_policies import validated_media_filename
from app.modules.media.media_library_queries import get_media_asset

__all__ = [
    "create_media_asset",
    "delete_media_asset",
    "get_media_asset",
    "rename_media_asset",
    "set_media_asset_ai_description",
    "validated_media_filename",
]


async def create_media_asset(
    media_url: str, content_type: str, filename: str, size_bytes: int, uploaded_by_user_id: int | None,
) -> dict:
    async with unit_of_work():
        item = await media_library_repository.create_media_asset(
            media_url, content_type, filename, size_bytes, uploaded_by_user_id,
        )
        collect(MediaLibraryChanged())
    return item


async def rename_media_asset(asset_id: int, filename: str) -> dict | None:
    """El nombre también se ve en los adjuntos de las plantillas que usan el
    recurso: el aviso refresca las dos pantallas."""
    async with unit_of_work():
        item = await media_library_repository.rename_media_asset(asset_id, filename)
        if item is not None:
            collect(MediaLibraryChanged(templates_affected=True))
    return item


async def set_media_asset_ai_description(asset_id: int, description: str | None) -> dict | None:
    async with unit_of_work():
        item = await media_library_repository.set_media_asset_ai_description(asset_id, description)
        if item is not None:
            collect(MediaLibraryChanged())
    return item


async def delete_media_asset(
    asset_id: int, *, before_delete: Callable[[str], Awaitable[None]] | None = None,
) -> str | None:
    async with unit_of_work():
        media_url = await media_library_repository.delete_media_asset(asset_id, before_delete=before_delete)
        if media_url is not None:
            collect(MediaLibraryChanged())
    return media_url

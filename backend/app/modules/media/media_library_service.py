from app.modules.media import media_library_repository
from app.modules.media.media_library_policies import (_asset, validated_media_filename)
from collections.abc import Awaitable, Callable
from datetime import datetime, timezone
from pathlib import Path


from app.db.models.media import MediaAsset
from app.db.models.catalogs import TemplateAttachment
from app.db.models.auth import User


def _asset_query():
    return media_library_repository._asset_query()


async def list_media_assets(search: str | None=None, kind: str | None=None) -> list[dict]:
    return await media_library_repository.list_media_assets(search, kind)


async def get_media_asset(asset_id: int) -> dict | None:
    return await media_library_repository.get_media_asset(asset_id)


async def create_media_asset(media_url: str, content_type: str, filename: str, size_bytes: int, uploaded_by_user_id: int | None) -> dict:
    return await media_library_repository.create_media_asset(media_url, content_type, filename, size_bytes, uploaded_by_user_id)


async def rename_media_asset(asset_id: int, filename: str) -> dict | None:
    return await media_library_repository.rename_media_asset(asset_id, filename)


async def set_media_asset_ai_description(asset_id: int, description: str | None) -> dict | None:
    return await media_library_repository.set_media_asset_ai_description(asset_id, description)


async def delete_media_asset(asset_id: int, *, before_delete: Callable[[str], Awaitable[None]] | None=None) -> str | None:
    return await media_library_repository.delete_media_asset(asset_id, before_delete=before_delete)

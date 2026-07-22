import asyncio
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException

from db.models import User
from models.schemas import MediaAssetCreate, MediaAssetItem
from routers.media import normalize_media_content_type, save_media_file
from services.auth_service import get_current_user, require_admin
from services.media_library_service import create_media_asset, delete_media_asset, list_media_assets
from services.media_storage import MediaStorageError, delete_media, media_size
from services.ws_manager import manager

router = APIRouter(prefix="/api/media-library", tags=["media-library"])


@router.get("", response_model=list[MediaAssetItem])
async def get_library(
    search: str | None = None,
    kind: Literal["image", "video", "audio", "document"] | None = None,
    _user: User = Depends(get_current_user),
):
    return await list_media_assets(search, kind)


@router.post("", response_model=MediaAssetItem, status_code=201)
async def post_library_asset(body: MediaAssetCreate, admin: User = Depends(require_admin)):
    content_type = normalize_media_content_type(body.content_type, body.filename)
    try:
        media_url = await asyncio.to_thread(
            save_media_file, content_type, body.data_base64, body.filename
        )
    except ValueError as exc:
        raise HTTPException(413 if "grande" in str(exc) else 400, str(exc))
    except MediaStorageError as exc:
        raise HTTPException(503, str(exc))

    try:
        size_bytes = await asyncio.to_thread(media_size, media_url)
        item = await create_media_asset(
            media_url=media_url,
            content_type=content_type,
            filename=body.filename,
            size_bytes=size_bytes,
            uploaded_by_user_id=admin.id,
        )
    except MediaStorageError as exc:
        try:
            await asyncio.to_thread(delete_media, media_url)
        except MediaStorageError:
            pass
        raise HTTPException(503, str(exc))
    except Exception:
        try:
            await asyncio.to_thread(delete_media, media_url)
        except MediaStorageError:
            pass
        raise
    await manager.broadcast({"type": "media_library_updated"})
    return item


@router.delete("/{asset_id}")
async def delete_library_asset(asset_id: int, _admin: User = Depends(require_admin)):
    try:
        media_url = await delete_media_asset(asset_id)
    except ValueError as exc:
        raise HTTPException(409, str(exc))
    if media_url is None:
        raise HTTPException(404, "Archivo no encontrado")
    try:
        await asyncio.to_thread(delete_media, media_url)
    except MediaStorageError as exc:
        raise HTTPException(503, str(exc))
    await manager.broadcast({"type": "media_library_updated"})
    return {"status": "ok"}

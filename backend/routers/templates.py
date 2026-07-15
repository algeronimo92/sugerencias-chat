from fastapi import APIRouter, Depends, HTTPException

from db.models import User
from models.schemas import PersonalTemplateCreate, TemplateAttachmentCreate, TemplateAttachmentItem, TemplateCreate, TemplateFavoriteUpdate, TemplateItem, TemplateLibraryAttachmentCreate, TemplateUpdate
from services.auth_service import get_current_user, require_admin
from services.productivity_service import (
    add_template_attachment, create_personal_template, create_template, list_templates,
    record_template_use, remove_template_attachment, set_template_favorite, update_template,
)
from routers.media import MEDIA_DIR, normalize_media_content_type, save_media_file
from services.media_library_service import create_media_asset, delete_media_asset, get_media_asset
from services.ws_manager import manager

router = APIRouter(prefix="/api/templates", tags=["templates"])


@router.get("", response_model=list[TemplateItem])
async def get_templates(include_inactive: bool = False, user: User = Depends(get_current_user)):
    return await list_templates(user.id, include_inactive and user.role == "admin")


@router.post("", response_model=TemplateItem, status_code=201)
async def post_template(body: TemplateCreate, admin: User = Depends(require_admin)):
    values = body.model_dump()
    for key in ("name", "content", "category"):
        values[key] = values[key].strip()
    if not values["name"] or not values["content"]:
        raise HTTPException(400, "Nombre y contenido son obligatorios")
    if values.get("shortcut"):
        values["shortcut"] = values["shortcut"].strip().lstrip("/").lower()
    try:
        item = await create_template(values, admin.id)
    except ValueError as exc:
        raise HTTPException(409, str(exc))
    await manager.broadcast({"type": "templates_updated"})
    return item


@router.post("/personal", response_model=TemplateItem, status_code=201)
async def post_personal_template(body: PersonalTemplateCreate, user: User = Depends(get_current_user)):
    name = body.name.strip()
    content = body.content.strip()
    shortcut = body.shortcut.strip().lstrip("/").lower() if body.shortcut else None
    if not name or not content:
        raise HTTPException(400, "Nombre y contenido son obligatorios")
    try:
        item = await create_personal_template(name, content, shortcut, user.id)
    except ValueError as exc:
        raise HTTPException(409, str(exc))
    await manager.broadcast({"type": "templates_updated"})
    return item


@router.put("/{template_id}/favorite")
async def put_favorite(template_id: int, body: TemplateFavoriteUpdate, user: User = Depends(get_current_user)):
    if not await set_template_favorite(template_id, user.id, body.is_favorite):
        raise HTTPException(404, "Plantilla no encontrada")
    return {"status": "ok"}


@router.post("/{template_id}/use")
async def post_template_use(template_id: int, user: User = Depends(get_current_user)):
    if not await record_template_use(template_id, user.id):
        raise HTTPException(404, "Plantilla no encontrada")
    return {"status": "ok"}


@router.post("/{template_id}/attachments", response_model=TemplateAttachmentItem, status_code=201)
async def post_attachment(template_id: int, body: TemplateAttachmentCreate, admin: User = Depends(require_admin)):
    content_type = normalize_media_content_type(body.content_type, body.filename)
    try:
        media_url = save_media_file(content_type, body.data_base64, body.filename)
    except ValueError as exc:
        raise HTTPException(413 if "grande" in str(exc) else 400, str(exc))
    path = MEDIA_DIR / media_url.rsplit("/", 1)[-1]
    try:
        asset = await create_media_asset(
            media_url, content_type, body.filename, path.stat().st_size, admin.id
        )
        item = await add_template_attachment(
            template_id, media_url, content_type, body.filename, asset["id"]
        )
    except ValueError as exc:
        if "asset" in locals():
            await delete_media_asset(asset["id"])
        path.unlink(missing_ok=True)
        raise HTTPException(400, str(exc))
    except Exception:
        if "asset" in locals():
            await delete_media_asset(asset["id"])
        path.unlink(missing_ok=True)
        raise
    if item is None:
        await delete_media_asset(asset["id"])
        path.unlink(missing_ok=True)
        raise HTTPException(404, "Plantilla no encontrada")
    await manager.broadcast({"type": "templates_updated"})
    await manager.broadcast({"type": "media_library_updated"})
    return item


@router.post("/{template_id}/attachments/library", response_model=TemplateAttachmentItem, status_code=201)
async def post_library_attachment(
    template_id: int,
    body: TemplateLibraryAttachmentCreate,
    _admin: User = Depends(require_admin),
):
    asset = await get_media_asset(body.asset_id)
    if asset is None:
        raise HTTPException(404, "Archivo de biblioteca no encontrado")
    try:
        item = await add_template_attachment(
            template_id,
            asset["media_url"],
            asset["content_type"],
            asset["filename"],
            asset["id"],
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    if item is None:
        raise HTTPException(404, "Plantilla no encontrada")
    await manager.broadcast({"type": "templates_updated"})
    await manager.broadcast({"type": "media_library_updated"})
    return item


@router.delete("/attachments/{attachment_id}")
async def delete_attachment(attachment_id: int, _admin: User = Depends(require_admin)):
    attachment = await remove_template_attachment(attachment_id)
    if attachment is None:
        raise HTTPException(404, "Adjunto no encontrado")
    if attachment["library_asset_id"] is None:
        (MEDIA_DIR / attachment["media_url"].rsplit("/", 1)[-1]).unlink(missing_ok=True)
    await manager.broadcast({"type": "templates_updated"})
    await manager.broadcast({"type": "media_library_updated"})
    return {"status": "ok"}


@router.patch("/{template_id}", response_model=TemplateItem)
async def patch_template(template_id: int, body: TemplateUpdate, _admin: User = Depends(require_admin)):
    values = body.model_dump(exclude_unset=True)
    if values.get("shortcut"):
        values["shortcut"] = values["shortcut"].strip().lstrip("/").lower()
    try:
        item = await update_template(template_id, values)
    except ValueError as exc:
        raise HTTPException(409, str(exc))
    if not item:
        raise HTTPException(404, "Plantilla no encontrada")
    await manager.broadcast({"type": "templates_updated"})
    return item

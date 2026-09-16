import asyncio
import contextlib
import logging

from fastapi import APIRouter, Depends, HTTPException

from db.models import User
from models.schemas import PersonalTemplateCreate, TemplateAttachmentCreate, TemplateAttachmentItem, TemplateCapabilities, TemplateCreate, TemplateFavoriteUpdate, TemplateItem, TemplateLibraryAttachmentCreate, TemplateUpdate
from services.auth_service import get_current_user, require_admin
from services.productivity_service import (
    add_template_attachment, create_personal_template, create_template, delete_template as delete_template_record, list_templates,
    record_template_use, remove_template_attachment, set_template_favorite, update_template,
)
from services.template_category_service import get_template_category_by_name
from services.media_upload import normalize_media_content_type, save_media_file
from services.media_library_service import create_media_asset, delete_media_asset, get_media_asset
from services.media_storage import MediaStorageError, delete_media, media_size
from services.ws_manager import manager
from services.meta_service import (
    MetaApiError, create_whatsapp_template, delete_whatsapp_template, describe_template_error,
    list_whatsapp_templates, update_whatsapp_template,
)
from services.whatsapp_capabilities import get_whatsapp_capabilities
from services.template_validation import (
    TemplateMediaError,
    TemplateValidationError,
    build_meta_components,
    normalize_common_fields,
    validate_internal_variables,
    validate_template_values,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/templates", tags=["templates"])

TEMPLATE_ERROR_STATUS: dict[type[Exception], int] = {
    TemplateValidationError: 400,
    TemplateMediaError: 502,
}


@contextlib.contextmanager
def _template_errors():
    try:
        yield
    except tuple(TEMPLATE_ERROR_STATUS) as exc:
        raise HTTPException(TEMPLATE_ERROR_STATUS[type(exc)], str(exc)) from exc


@router.get("", response_model=list[TemplateItem])
async def get_templates(include_inactive: bool = False, user: User = Depends(get_current_user)):
    return await list_templates(user.id, include_inactive and user.role == "admin")


@router.get("/capabilities", response_model=TemplateCapabilities)
async def get_capabilities(_user: User = Depends(get_current_user)):
    return await get_whatsapp_capabilities()


@router.post("", response_model=TemplateItem, status_code=201)
async def post_template(body: TemplateCreate, admin: User = Depends(require_admin)):
    values = body.model_dump()
    with _template_errors():
        values = await validate_template_values(values)
    category = await get_template_category_by_name(values["category"])
    if category is None:
        raise HTTPException(400, "Selecciona una categoría activa del catálogo")
    values["category"] = category["name"]
    if values["template_type"] == "official":
        with _template_errors():
            components = await build_meta_components(values)
        try:
            created = await create_whatsapp_template(
                values["official_name"], values["official_category"], values["official_language"], components,
            )
        except MetaApiError as exc:
            raise HTTPException(502, describe_template_error(exc))
        # Meta devuelve el shape nativo directo ({"id","status","category"}),
        # ya no el wrapper {"templateId","template":{...}} que armaba Evolution.
        values["meta_template_id"] = created.get("id")
        values["official_status"] = created.get("status") or "PENDING"
    try:
        item = await create_template(values, admin.id)
    except ValueError as exc:
        raise HTTPException(409, str(exc))
    await manager.broadcast({"type": "templates_updated"})
    return item


@router.post("/personal", response_model=TemplateItem, status_code=201)
async def post_personal_template(body: PersonalTemplateCreate, user: User = Depends(get_current_user)):
    values = {
        "name": body.name,
        "content": body.content,
        "shortcut": body.shortcut,
        "category": "personal",
        "template_type": "internal",
        "interactive_type": "none",
    }
    with _template_errors():
        normalize_common_fields(values)
        validate_internal_variables(values["content"])
    try:
        item = await create_personal_template(values["name"], values["content"], values["shortcut"], user.id)
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
        media_url = await asyncio.to_thread(
            save_media_file, content_type, body.data_base64, body.filename
        )
    except ValueError as exc:
        raise HTTPException(413 if "grande" in str(exc) else 400, str(exc))
    except MediaStorageError as exc:
        raise HTTPException(503, str(exc))
    try:
        size_bytes = await asyncio.to_thread(media_size, media_url)
        asset = await create_media_asset(
            media_url, content_type, body.filename, size_bytes, admin.id
        )
        item = await add_template_attachment(
            template_id, media_url, content_type, body.filename, asset["id"]
        )
    except ValueError as exc:
        if "asset" in locals():
            await delete_media_asset(asset["id"])
        try:
            await asyncio.to_thread(delete_media, media_url)
        except MediaStorageError:
            pass
        raise HTTPException(400, str(exc))
    except MediaStorageError as exc:
        if "asset" in locals():
            await delete_media_asset(asset["id"])
        try:
            await asyncio.to_thread(delete_media, media_url)
        except MediaStorageError:
            pass
        raise HTTPException(503, str(exc))
    except Exception:
        if "asset" in locals():
            await delete_media_asset(asset["id"])
        try:
            await asyncio.to_thread(delete_media, media_url)
        except MediaStorageError:
            pass
        raise
    if item is None:
        await delete_media_asset(asset["id"])
        try:
            await asyncio.to_thread(delete_media, media_url)
        except MediaStorageError:
            pass
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
        try:
            await asyncio.to_thread(delete_media, attachment["media_url"])
        except MediaStorageError as exc:
            raise HTTPException(503, str(exc))
    await manager.broadcast({"type": "templates_updated"})
    await manager.broadcast({"type": "media_library_updated"})
    return {"status": "ok"}


@router.patch("/{template_id}", response_model=TemplateItem)
async def patch_template(template_id: int, body: TemplateUpdate, _admin: User = Depends(require_admin)):
    values = body.model_dump(exclude_unset=True)
    current = next((item for item in await list_templates(_admin.id, True) if item["id"] == template_id), None)
    if current is None:
        raise HTTPException(404, "Plantilla no encontrada")
    merged = {**current, **values}
    with _template_errors():
        await validate_template_values(merged)
    category_changed = (
        "category" in values
        and str(merged["category"]).casefold() != str(current["category"]).casefold()
    )
    if category_changed:
        category = await get_template_category_by_name(merged["category"])
        if category is None:
            raise HTTPException(400, "Selecciona una categoría activa del catálogo")
        merged["category"] = category["name"]
    if merged.get("interactive_type") != "none" and current["attachments"]:
        raise HTTPException(400, "Quita los adjuntos antes de convertir la plantilla en interactiva")
    if current["template_type"] == "official" and current.get("meta_template_id"):
        if (
            merged.get("official_name") != current.get("official_name")
            or merged.get("official_language") != current.get("official_language")
        ):
            raise HTTPException(
                400,
                "El nombre y el idioma de una plantilla ya enviada a Meta no se pueden cambiar; creá una nueva plantilla",
            )
        content_changed = any(
            merged.get(field) != current.get(field)
            for field in (
                "content", "official_header_type", "official_header_text",
                "official_header_media_asset_id", "official_footer", "official_buttons",
            )
        )
        category_changed_meta = merged.get("official_category") != current.get("official_category")
        if content_changed or category_changed_meta:
            with _template_errors():
                components = (await build_meta_components(merged)) if content_changed else None
            try:
                await update_whatsapp_template(
                    current["meta_template_id"],
                    components,
                    merged["official_category"] if category_changed_meta else None,
                )
            except MetaApiError as exc:
                raise HTTPException(502, describe_template_error(exc))
    for key in ("name", "content", "category", "shortcut"):
        if key in values:
            values[key] = merged[key]
    for key in (
        "official_name", "official_language", "official_category",
        "official_status", "official_parameter_values",
        "official_header_type", "official_header_text", "official_header_media_asset_id",
        "official_footer", "official_buttons",
        "interactive_type", "interactive_config",
    ):
        if key in values or current["template_type"] == "official":
            values[key] = merged[key]
    try:
        item = await update_template(template_id, values)
    except ValueError as exc:
        raise HTTPException(409, str(exc))
    if not item:
        raise HTTPException(404, "Plantilla no encontrada")
    await manager.broadcast({"type": "templates_updated"})
    return item


@router.delete("/{template_id}")
async def delete_template(template_id: int, _admin: User = Depends(require_admin)):
    try:
        deleted = await delete_template_record(template_id)
    except ValueError as exc:
        raise HTTPException(409, str(exc))
    if deleted is None:
        raise HTTPException(404, "Plantilla no encontrada")
    if deleted["template_type"] == "official" and deleted.get("meta_template_id"):
        try:
            await delete_whatsapp_template(deleted["official_name"], deleted["meta_template_id"])
        except MetaApiError as exc:
            logger.warning("No se pudo borrar la plantilla %s en Meta: %s", deleted["official_name"], exc)
    await manager.broadcast({"type": "templates_updated"})
    await manager.broadcast({"type": "media_library_updated"})
    return {"status": "ok"}


@router.post("/{template_id}/sync", response_model=TemplateItem)
async def post_sync_template(template_id: int, admin: User = Depends(require_admin)):
    """Refresca `official_status` consultando el estado real de la plantilla
    en Meta, en vez de que el admin lo tipee a mano tras revisar el WhatsApp
    Manager."""
    current = next((item for item in await list_templates(admin.id, True) if item["id"] == template_id), None)
    if current is None:
        raise HTTPException(404, "Plantilla no encontrada")
    if current["template_type"] != "official" or not current.get("meta_template_id"):
        raise HTTPException(400, "Esta plantilla no está vinculada a Meta")
    try:
        remote_templates = await list_whatsapp_templates()
    except MetaApiError as exc:
        raise HTTPException(502, describe_template_error(exc))
    remote = next((row for row in remote_templates if row.get("id") == current["meta_template_id"]), None)
    if remote is None:
        raise HTTPException(404, "Meta ya no tiene esta plantilla; puede haber sido borrada desde el WhatsApp Manager")
    status = remote.get("status")
    reason = remote.get("rejected_reason")
    reason = reason if reason and reason != "NONE" else None
    item = await update_template(
        template_id, {"official_status": status, "official_rejected_reason": reason},
    ) if status else current
    await manager.broadcast({"type": "templates_updated"})
    return item

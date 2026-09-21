import asyncio
import base64
import contextlib
import logging

from fastapi import APIRouter, Depends, HTTPException

from db.models import User
from models.schemas import PersonalTemplateCreate, TemplateAttachmentCreate, TemplateAttachmentItem, TemplateCapabilities, TemplateCreate, TemplateFavoriteUpdate, TemplateItem, TemplateLibraryAttachmentCreate, TemplateMetaImport, TemplateUpdate
from services.auth_service import get_current_user, require_admin
from services.template_service import (
    add_template_attachment,
    create_personal_template,
    create_template,
    delete_template as delete_template_record,
    list_templates,
    record_template_use,
    remove_template_attachment,
    set_template_favorite,
    update_template,
)
from services.template_category_service import get_template_category_by_name
from services.media_upload import normalize_media_content_type, save_media_file
from services.media_library_service import create_media_asset, delete_media_asset, get_media_asset
from services.media_storage import MediaStorageError, delete_media, media_size
from services.ws_manager import manager
from services.meta_service import (
    MetaApiError, create_whatsapp_template, delete_whatsapp_template, describe_template_error,
    download_template_header_example, get_whatsapp_template, list_whatsapp_templates,
    update_whatsapp_template, upload_header_media,
)
from services.whatsapp_capabilities import get_whatsapp_capabilities
from services.template_validation import (
    TemplateMediaError,
    TemplateValidationError,
    build_meta_components,
    normalize_common_fields,
    template_parameter_identifiers,
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


@router.get("/meta")
async def get_meta_templates(_admin: User = Depends(require_admin)):
    """Lista tal cual las devuelve Meta (`GET /{waba_id}/message_templates`),
    sin pasar por las plantillas guardadas en la BD -- sirve para ver el
    estado real de la WABA, por ejemplo plantillas creadas desde el WhatsApp
    Manager que todavía no se vincularon acá."""
    try:
        return await list_whatsapp_templates()
    except MetaApiError as exc:
        raise HTTPException(502, describe_template_error(exc))


@router.get("/meta/{meta_template_id}")
async def get_meta_template_detail(meta_template_id: str, _admin: User = Depends(require_admin)):
    """Detalle completo (con `components`) de una plantilla puntual de Meta --
    lo que necesita el diálogo de importación para mostrar cuántas variables
    tiene el body antes de pedirle al admin sus valores por defecto."""
    try:
        return await get_whatsapp_template(meta_template_id)
    except MetaApiError as exc:
        raise HTTPException(502, describe_template_error(exc))


async def _import_header_media_asset(header: dict, remote_name: str, admin_id: int) -> int | None:
    """Descarga el ejemplo de imagen del encabezado (si Meta lo da) y lo
    guarda como un asset local, para que la plantilla importada quede con
    header IMAGE de verdad y no solo "sin encabezado".

    Cualquier fallo acá (sin ejemplo, tipo no soportado, falla de red) se
    degrada a "sin encabezado" en el llamador en vez de abortar todo el
    import -- el header es solo para la vista previa local, el envío nunca
    lo manda (ver `send_template` en `routers/chats.py`)."""
    example_urls = ((header.get("example") or {}).get("header_handle")) or []
    example_url = example_urls[0] if example_urls else None
    if not example_url:
        return None
    try:
        content, content_type = await download_template_header_example(example_url)
    except MetaApiError:
        logger.warning("No se pudo descargar el ejemplo del encabezado de %s", remote_name)
        return None
    if not content_type.startswith("image/"):
        return None
    extension = content_type.split("/", 1)[-1] or "jpg"
    filename = f"{remote_name}.{extension}"
    try:
        media_url = await asyncio.to_thread(
            save_media_file, content_type, base64.b64encode(content).decode(), filename,
        )
        size_bytes = await asyncio.to_thread(media_size, media_url)
        asset = await create_media_asset(media_url, content_type, filename, size_bytes, admin_id)
    except (ValueError, MediaStorageError):
        logger.warning("No se pudo guardar el ejemplo del encabezado de %s como asset", remote_name)
        return None
    return asset["id"]


async def _parse_meta_template(remote: dict, admin_id: int) -> dict:
    """Traduce el shape nativo de la Graph API (`components`) a los campos
    internos `official_*`, en el sentido inverso a `_build_meta_components`."""
    components = remote.get("components") or []
    body = next((c for c in components if c.get("type") == "BODY"), None)
    header = next((c for c in components if c.get("type") == "HEADER"), None)
    footer = next((c for c in components if c.get("type") == "FOOTER"), None)
    buttons_component = next((c for c in components if c.get("type") == "BUTTONS"), None)

    official_header_type = "none"
    official_header_text = None
    official_header_media_asset_id = None
    if header and header.get("format") == "TEXT":
        official_header_type = "text"
        official_header_text = header.get("text")
    elif header and header.get("format") == "IMAGE":
        official_header_media_asset_id = await _import_header_media_asset(
            header, remote.get("name") or "plantilla", admin_id,
        )
        official_header_type = "image" if official_header_media_asset_id is not None else "none"

    official_buttons: list[dict] = []
    for button in (buttons_component or {}).get("buttons") or []:
        button_type = button.get("type")
        if button_type == "QUICK_REPLY":
            official_buttons.append({"type": "quick_reply", "text": button.get("text", "")})
        elif button_type == "URL":
            official_buttons.append({"type": "url", "text": button.get("text", ""), "url": button.get("url", "")})
        elif button_type == "PHONE_NUMBER":
            official_buttons.append({
                "type": "phone_number", "text": button.get("text", ""),
                "phone_number": button.get("phone_number", ""),
            })

    rejected_reason = remote.get("rejected_reason")
    return {
        "content": (body or {}).get("text") or "",
        "meta_template_id": remote.get("id"),
        "official_name": remote.get("name"),
        "official_language": remote.get("language"),
        "official_category": remote.get("category"),
        "official_status": remote.get("status") or "PENDING",
        "official_rejected_reason": rejected_reason if rejected_reason and rejected_reason != "NONE" else None,
        "official_header_type": official_header_type,
        "official_header_text": official_header_text,
        "official_header_media_asset_id": official_header_media_asset_id,
        "official_footer": (footer or {}).get("text"),
        "official_buttons": official_buttons,
    }


@router.post("/meta/{meta_template_id}/import", response_model=TemplateItem, status_code=201)
async def post_import_meta_template(
    meta_template_id: str, body: TemplateMetaImport, admin: User = Depends(require_admin),
):
    """Vincula a la app una plantilla que ya existe (y está aprobada o en
    revisión) del lado de Meta -- por ejemplo, creada desde el WhatsApp
    Manager -- sin volver a darla de alta en la Graph API."""
    already_linked = any(
        item.get("meta_template_id") == meta_template_id
        for item in await list_templates(admin.id, True)
    )
    if already_linked:
        raise HTTPException(409, "Esta plantilla de Meta ya está vinculada a la app")
    try:
        remote = await get_whatsapp_template(meta_template_id)
    except MetaApiError as exc:
        raise HTTPException(502, describe_template_error(exc))

    values = await _parse_meta_template(remote, admin.id)
    values.update({
        "name": body.name,
        "shortcut": body.shortcut,
        "category": body.category,
        "template_type": "official",
        "interactive_type": "none",
        "interactive_config": {},
        "stage": None,
        "task_type": None,
        "service": None,
        "official_parameter_values": [str(value).strip() for value in body.official_parameter_values],
        "imported_from_meta": True,
    })
    with _template_errors():
        normalize_common_fields(values)
    expected_count = len(template_parameter_identifiers(values["content"]))
    if len(values["official_parameter_values"]) != expected_count or any(not value for value in values["official_parameter_values"]):
        raise HTTPException(400, f"Debes configurar un valor para cada una de las {expected_count} variables oficiales")
    with _template_errors():
        validate_internal_variables(values["official_parameter_values"])

    category = await get_template_category_by_name(values["category"])
    if category is None:
        raise HTTPException(400, "Selecciona una categoría activa del catálogo")
    values["category"] = category["name"]
    try:
        item = await create_template(values, admin.id)
    except ValueError as exc:
        raise HTTPException(409, str(exc))
    await manager.broadcast({"type": "templates_updated"})
    return item


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
    # Una plantilla importada ya existía en Meta antes que en esta app: borrar
    # el vínculo local no debe borrar la plantilla real de la WABA, a
    # diferencia de una creada acá (donde esta app es la dueña del ciclo de
    # vida en Meta).
    if deleted["template_type"] == "official" and deleted.get("meta_template_id") and not deleted.get("imported_from_meta"):
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

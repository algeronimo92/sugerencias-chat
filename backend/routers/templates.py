import asyncio
import logging
import re

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
from services.media_storage import MediaStorageError, delete_media, media_size, read_media_bytes
from services.ws_manager import manager
from services.meta_service import (
    MetaApiError, create_whatsapp_template, delete_whatsapp_template, describe_template_error,
    list_whatsapp_templates, update_whatsapp_template, upload_header_media,
)
from services.whatsapp_capabilities import get_whatsapp_capabilities
from services.whatsapp_rules import (
    LIMITS as INTERACTIVE_LIMITS,
    MAX_TEXT_LENGTH,
    InteractiveRuleError,
    normalize_interactive_config,
    resolve_interactive_footer,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/templates", tags=["templates"])
ALLOWED_INTERNAL_VARIABLES = {"nombre", "telefono", "servicio", "vendedor", "fecha_actual"}
MAX_TEMPLATE_NAME_LENGTH = 120
MAX_SHORTCUT_LENGTH = 50
MAX_CATEGORY_LENGTH = 60
MAX_OFFICIAL_HEADER_TEXT_LENGTH = 60
MAX_OFFICIAL_FOOTER_LENGTH = 60
MAX_OFFICIAL_BUTTON_TEXT_LENGTH = 25
MAX_OFFICIAL_BUTTON_URL_LENGTH = 2000


def _template_variables(value: object) -> set[str]:
    if isinstance(value, str):
        return {match.strip() for match in re.findall(r"\{\{\s*([^{}]+?)\s*\}\}", value)}
    if isinstance(value, list):
        return set().union(*(_template_variables(item) for item in value)) if value else set()
    if isinstance(value, dict):
        return set().union(*(_template_variables(item) for item in value.values())) if value else set()
    return set()


def _normalize_and_validate_common(values: dict) -> None:
    name = str(values.get("name") or "").strip()
    content = str(values.get("content") or "").strip()
    category = str(values.get("category") or "").strip()
    shortcut = str(values.get("shortcut") or "").strip().lstrip("/").lower() or None
    if not name or not content or not category:
        raise HTTPException(400, "Nombre, contenido y categoría son obligatorios")
    if len(name) > MAX_TEMPLATE_NAME_LENGTH:
        raise HTTPException(400, f"El nombre admite máximo {MAX_TEMPLATE_NAME_LENGTH} caracteres")
    if len(category) > MAX_CATEGORY_LENGTH:
        raise HTTPException(400, f"La categoría admite máximo {MAX_CATEGORY_LENGTH} caracteres")
    if shortcut and (
        len(shortcut) > MAX_SHORTCUT_LENGTH or not re.fullmatch(r"[a-z0-9_-]+", shortcut)
    ):
        raise HTTPException(
            400,
            f"El atajo admite máximo {MAX_SHORTCUT_LENGTH} caracteres: letras minúsculas, números, - y _",
        )

    interactive = values.get("template_type", "internal") == "internal" and values.get("interactive_type") != "none"
    content_limit = INTERACTIVE_LIMITS.body if interactive or values.get("template_type") == "official" else MAX_TEXT_LENGTH
    if len(content) > content_limit:
        raise HTTPException(400, f"El contenido admite máximo {content_limit} caracteres para este tipo de plantilla")

    values.update({"name": name, "content": content, "category": category, "shortcut": shortcut})


def _validate_internal_variables(*values: object) -> None:
    unknown = set().union(*(_template_variables(value) for value in values)) - ALLOWED_INTERNAL_VARIABLES
    if unknown:
        formatted = ", ".join(f"{{{{{name}}}}}" for name in sorted(unknown))
        raise HTTPException(400, f"Variables no reconocidas: {formatted}")


async def _validate_interactive_config(values: dict) -> None:
    interactive_type = values.get("interactive_type") or "none"
    config = values.get("interactive_config") or {}
    try:
        footer = "" if interactive_type == "none" else await resolve_interactive_footer(interactive_type, config)
        values["interactive_config"] = normalize_interactive_config(interactive_type, config, footer)
    except InteractiveRuleError as exc:
        raise HTTPException(400, str(exc)) from exc
    values["interactive_type"] = interactive_type


async def _validate_official_components(values: dict) -> None:
    header_type = values.get("official_header_type") or "none"
    if header_type == "text":
        header_text = str(values.get("official_header_text") or "").strip()
        if not header_text:
            raise HTTPException(400, "El encabezado de texto no puede estar vacío")
        if len(header_text) > MAX_OFFICIAL_HEADER_TEXT_LENGTH:
            raise HTTPException(400, f"El encabezado admite máximo {MAX_OFFICIAL_HEADER_TEXT_LENGTH} caracteres")
        if _template_variables(header_text):
            raise HTTPException(400, "El encabezado de una plantilla oficial no admite variables")
        values["official_header_type"] = "text"
        values["official_header_text"] = header_text
        values["official_header_media_asset_id"] = None
    elif header_type == "image":
        asset_id = values.get("official_header_media_asset_id")
        if not asset_id:
            raise HTTPException(400, "Selecciona una imagen para el encabezado")
        asset = await get_media_asset(asset_id)
        if asset is None:
            raise HTTPException(400, "El archivo elegido para el encabezado ya no existe en la librería de medios")
        if not asset["content_type"].startswith("image/"):
            raise HTTPException(400, "El encabezado con imagen solo admite archivos de imagen")
        values["official_header_type"] = "image"
        values["official_header_text"] = None
        values["official_header_media_asset_id"] = asset_id
    else:
        values["official_header_type"] = "none"
        values["official_header_text"] = None
        values["official_header_media_asset_id"] = None

    footer = str(values.get("official_footer") or "").strip()
    if footer:
        if len(footer) > MAX_OFFICIAL_FOOTER_LENGTH:
            raise HTTPException(400, f"El pie admite máximo {MAX_OFFICIAL_FOOTER_LENGTH} caracteres")
        if _template_variables(footer):
            raise HTTPException(400, "El pie de una plantilla oficial no admite variables")
    values["official_footer"] = footer or None

    buttons = values.get("official_buttons") if isinstance(values.get("official_buttons"), list) else []
    if len(buttons) > 3:
        raise HTTPException(400, "Una plantilla oficial admite como máximo 3 botones")
    has_quick_reply = any(isinstance(item, dict) and item.get("type") == "quick_reply" for item in buttons)
    if has_quick_reply and any(isinstance(item, dict) and item.get("type") != "quick_reply" for item in buttons):
        raise HTTPException(400, "Los botones de respuesta rápida no pueden mezclarse con botones de URL o teléfono")
    if not has_quick_reply and len(buttons) > 2:
        raise HTTPException(400, "Una plantilla oficial admite como máximo 2 botones de URL o teléfono")
    normalized: list[dict] = []
    seen_texts: set[str] = set()
    for item in buttons:
        if not isinstance(item, dict) or item.get("type") not in ("quick_reply", "url", "phone_number"):
            raise HTTPException(400, "Tipo de botón no soportado en plantillas oficiales")
        button_type = item["type"]
        text = str(item.get("text") or "").strip()
        if not text or text.lower() in seen_texts:
            raise HTTPException(400, "Cada botón necesita un texto único")
        if len(text) > MAX_OFFICIAL_BUTTON_TEXT_LENGTH:
            raise HTTPException(400, f"El texto de cada botón admite máximo {MAX_OFFICIAL_BUTTON_TEXT_LENGTH} caracteres")
        seen_texts.add(text.lower())
        result = {"type": button_type, "text": text}
        if button_type == "url":
            url = str(item.get("url") or "").strip()
            if not re.fullmatch(r"https://[^\s]+", url, flags=re.IGNORECASE):
                raise HTTPException(400, "Las URL de botones deben ser completas y comenzar con https://")
            if len(url) > MAX_OFFICIAL_BUTTON_URL_LENGTH:
                raise HTTPException(400, f"La URL admite máximo {MAX_OFFICIAL_BUTTON_URL_LENGTH} caracteres")
            if _template_variables(url):
                raise HTTPException(400, "Las URL de botones oficiales no admiten variables en esta versión")
            result["url"] = url
        elif button_type == "phone_number":
            phone = re.sub(r"[\s()\-]", "", str(item.get("phone_number") or ""))
            if not re.fullmatch(r"\+?[1-9]\d{7,14}", phone):
                raise HTTPException(400, "El teléfono del botón debe incluir código de país y tener entre 8 y 15 dígitos")
            result["phone_number"] = phone
        normalized.append(result)
    values["official_buttons"] = normalized


async def _build_meta_components(values: dict) -> list[dict]:
    """Arma el `components` que espera la Graph API de Meta a partir de los
    campos ya validados de una plantilla oficial. Evolution lo pasa tal cual
    (confirmado en `template.service.ts` 2.3.7), así que el formato acá tiene
    que ser exactamente el de Meta, no el interno de esta app.

    Un encabezado de imagen exige que Meta ya tenga el archivo antes de crear
    la plantilla (el `header_handle` del resumable upload) — Evolution no
    tiene equivalente de esto, así que acá se sube directo a la Graph API."""
    components: list[dict] = []
    header_type = values.get("official_header_type")
    if header_type == "text" and values.get("official_header_text"):
        components.append({"type": "HEADER", "format": "TEXT", "text": values["official_header_text"]})
    elif header_type == "image" and values.get("official_header_media_asset_id"):
        asset = await get_media_asset(values["official_header_media_asset_id"])
        if asset is None:
            raise HTTPException(400, "El archivo elegido para el encabezado ya no existe en la librería de medios")
        content = await asyncio.to_thread(read_media_bytes, asset["media_url"])
        try:
            handle = await upload_header_media(content, asset["content_type"], asset["filename"])
        except MetaApiError as exc:
            raise HTTPException(502, describe_template_error(exc))
        components.append({"type": "HEADER", "format": "IMAGE", "example": {"header_handle": [handle]}})
    components.append({"type": "BODY", "text": values["content"]})
    if values.get("official_footer"):
        components.append({"type": "FOOTER", "text": values["official_footer"]})
    buttons = values.get("official_buttons") or []
    if buttons:
        meta_buttons = []
        for button in buttons:
            if button["type"] == "quick_reply":
                meta_buttons.append({"type": "QUICK_REPLY", "text": button["text"]})
            elif button["type"] == "url":
                meta_buttons.append({"type": "URL", "text": button["text"], "url": button["url"]})
            else:
                meta_buttons.append({"type": "PHONE_NUMBER", "text": button["text"], "phone_number": button["phone_number"]})
        components.append({"type": "BUTTONS", "buttons": meta_buttons})
    return components


async def _validate_template_values(values: dict) -> dict:
    _normalize_and_validate_common(values)
    template_type = values.get("template_type", "internal")
    if template_type == "internal":
        values.update({
            "official_name": None,
            "official_language": None,
            "official_category": None,
            "official_status": None,
            "official_parameter_values": [],
            "official_header_type": "none",
            "official_header_text": None,
            "official_header_media_asset_id": None,
            "official_footer": None,
            "official_buttons": [],
        })
        await _validate_interactive_config(values)
        _validate_internal_variables(values["content"], values["interactive_config"])
        return values

    official_name = (values.get("official_name") or "").strip().lower()
    official_language = (values.get("official_language") or "").strip()
    if not re.fullmatch(r"[a-z0-9_]+", official_name):
        raise HTTPException(400, "El nombre oficial solo admite minúsculas, números y guiones bajos")
    if not official_language:
        raise HTTPException(400, "El idioma oficial es obligatorio")
    if len(official_name) > 512:
        raise HTTPException(400, "El nombre oficial admite máximo 512 caracteres")
    if not re.fullmatch(r"[a-z]{2,3}(?:_[A-Z]{2})?", official_language):
        raise HTTPException(400, "El idioma oficial debe tener un formato como es, es_PE o en_US")
    if not values.get("official_category"):
        raise HTTPException(400, "La categoría oficial es obligatoria")

    positions = sorted({int(value) for value in re.findall(r"\{\{(\d+)\}\}", values.get("content") or "")})
    invalid_official_variables = {value for value in _template_variables(values.get("content")) if not value.isdigit()}
    if invalid_official_variables:
        raise HTTPException(400, "El contenido oficial solo admite variables numéricas como {{1}}, {{2}}, ...")
    expected_positions = list(range(1, (positions[-1] if positions else 0) + 1))
    if positions != expected_positions:
        raise HTTPException(400, "Las variables oficiales deben ser consecutivas: {{1}}, {{2}}, ...")
    parameters = [str(value).strip() for value in values.get("official_parameter_values") or []]
    if len(parameters) != len(expected_positions) or any(not value for value in parameters):
        raise HTTPException(400, f"Debes configurar un valor para cada una de las {len(expected_positions)} variables oficiales")
    _validate_internal_variables(parameters)
    values["official_name"] = official_name
    values["official_language"] = official_language
    values["official_parameter_values"] = parameters
    values["interactive_type"] = "none"
    values["interactive_config"] = {}
    await _validate_official_components(values)
    return values


@router.get("", response_model=list[TemplateItem])
async def get_templates(include_inactive: bool = False, user: User = Depends(get_current_user)):
    return await list_templates(user.id, include_inactive and user.role == "admin")


@router.get("/capabilities", response_model=TemplateCapabilities)
async def get_capabilities(_user: User = Depends(get_current_user)):
    return await get_whatsapp_capabilities()


@router.post("", response_model=TemplateItem, status_code=201)
async def post_template(body: TemplateCreate, admin: User = Depends(require_admin)):
    values = body.model_dump()
    values = await _validate_template_values(values)
    category = await get_template_category_by_name(values["category"])
    if category is None:
        raise HTTPException(400, "Selecciona una categoría activa del catálogo")
    values["category"] = category["name"]
    if values["template_type"] == "official":
        components = await _build_meta_components(values)
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
    _normalize_and_validate_common(values)
    _validate_internal_variables(values["content"])
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
    await _validate_template_values(merged)
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
            try:
                await update_whatsapp_template(
                    current["meta_template_id"],
                    (await _build_meta_components(merged)) if content_changed else None,
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

import re

from fastapi import APIRouter, Depends, HTTPException

from db.models import User
from models.schemas import PersonalTemplateCreate, TemplateAttachmentCreate, TemplateAttachmentItem, TemplateCapabilities, TemplateCreate, TemplateFavoriteUpdate, TemplateItem, TemplateLibraryAttachmentCreate, TemplateUpdate
from services.auth_service import get_current_user, require_admin
from services.productivity_service import (
    add_template_attachment, create_personal_template, create_template, list_templates,
    record_template_use, remove_template_attachment, set_template_favorite, update_template,
)
from routers.media import MEDIA_DIR, normalize_media_content_type, save_media_file
from services.media_library_service import create_media_asset, delete_media_asset, get_media_asset
from services.ws_manager import manager
from services.evolution_service import EvolutionApiError, get_template_capabilities

router = APIRouter(prefix="/api/templates", tags=["templates"])
DEFAULT_INTERACTIVE_FOOTER = "DermicaPro"
ALLOWED_INTERNAL_VARIABLES = {"nombre", "telefono", "servicio", "vendedor", "fecha_actual"}
MAX_TEMPLATE_NAME_LENGTH = 120
MAX_SHORTCUT_LENGTH = 50
MAX_CATEGORY_LENGTH = 60
MAX_TEXT_LENGTH = 4096
MAX_INTERACTIVE_BODY_LENGTH = 1024
MAX_INTERACTIVE_TITLE_LENGTH = 60
MAX_INTERACTIVE_FOOTER_LENGTH = 60
MAX_BUTTON_TEXT_LENGTH = 20
MAX_BUTTON_ID_LENGTH = 256
MAX_LIST_SECTION_TITLE_LENGTH = 24
MAX_LIST_ROW_TITLE_LENGTH = 24
MAX_LIST_ROW_DESCRIPTION_LENGTH = 72
MAX_LIST_ROW_ID_LENGTH = 200


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
    content_limit = MAX_INTERACTIVE_BODY_LENGTH if interactive or values.get("template_type") == "official" else MAX_TEXT_LENGTH
    if len(content) > content_limit:
        raise HTTPException(400, f"El contenido admite máximo {content_limit} caracteres para este tipo de plantilla")

    values.update({"name": name, "content": content, "category": category, "shortcut": shortcut})


def _validate_internal_variables(*values: object) -> None:
    unknown = set().union(*(_template_variables(value) for value in values)) - ALLOWED_INTERNAL_VARIABLES
    if unknown:
        formatted = ", ".join(f"{{{{{name}}}}}" for name in sorted(unknown))
        raise HTTPException(400, f"Variables no reconocidas: {formatted}")


def _validate_interactive_config(values: dict) -> None:
    interactive_type = values.get("interactive_type") or "none"
    config = values.get("interactive_config") or {}
    if interactive_type == "none":
        values["interactive_type"] = "none"
        values["interactive_config"] = {}
        return
    if interactive_type == "buttons":
        title = str(config.get("title") or "").strip()
        footer = str(config.get("footer") or "").strip() or DEFAULT_INTERACTIVE_FOOTER
        buttons = config.get("buttons") if isinstance(config.get("buttons"), list) else []
        if not title or not 1 <= len(buttons) <= 3:
            raise HTTPException(400, "Los botones requieren título y entre 1 y 3 opciones")
        if len(title) > MAX_INTERACTIVE_TITLE_LENGTH:
            raise HTTPException(400, f"El título interactivo admite máximo {MAX_INTERACTIVE_TITLE_LENGTH} caracteres")
        if len(footer) > MAX_INTERACTIVE_FOOTER_LENGTH:
            raise HTTPException(400, f"El pie de mensaje admite máximo {MAX_INTERACTIVE_FOOTER_LENGTH} caracteres")
        normalized = []
        seen_texts: set[str] = set()
        seen_ids: set[str] = set()
        has_reply = any(isinstance(item, dict) and item.get("type") == "reply" for item in buttons)
        if has_reply and any(not isinstance(item, dict) or item.get("type") != "reply" for item in buttons):
            raise HTTPException(400, "Los botones de respuesta no pueden mezclarse con otros tipos")
        if not has_reply and len(buttons) > 2:
            raise HTTPException(400, "WhatsApp admite máximo 2 botones de URL, llamada o copia")
        for index, item in enumerate(buttons):
            if not isinstance(item, dict) or item.get("type") not in ("reply", "url", "call", "copy"):
                raise HTTPException(400, "Tipo de botón no soportado")
            button_type = item["type"]
            display_text = str(item.get("displayText") or "").strip()
            if not display_text or display_text.lower() in seen_texts:
                raise HTTPException(400, "Cada botón necesita un texto único")
            if len(display_text) > MAX_BUTTON_TEXT_LENGTH:
                raise HTTPException(400, f"El texto de cada botón admite máximo {MAX_BUTTON_TEXT_LENGTH} caracteres")
            seen_texts.add(display_text.lower())
            result = {"type": button_type, "displayText": display_text}
            field = {"reply": "id", "url": "url", "call": "phoneNumber", "copy": "copyCode"}[button_type]
            value = str(item.get(field) or (f"reply_{index + 1}" if field == "id" else "")).strip()
            if not value:
                raise HTTPException(400, f"Falta configurar {field} en el botón {index + 1}")
            if field == "id" and len(value) > MAX_BUTTON_ID_LENGTH:
                raise HTTPException(400, f"El ID de respuesta admite máximo {MAX_BUTTON_ID_LENGTH} caracteres")
            if field == "url" and not re.fullmatch(r"https://[^\s]+", value, flags=re.IGNORECASE):
                raise HTTPException(400, "Las URL de botones deben ser completas y comenzar con https://")
            if field == "url" and len(value) > 2048:
                raise HTTPException(400, "Las URL de botones admiten máximo 2048 caracteres")
            if field == "phoneNumber":
                value = re.sub(r"[\s()\-]", "", value)
                if not re.fullmatch(r"\+?[1-9]\d{7,14}", value):
                    raise HTTPException(400, "El teléfono del botón debe incluir código de país y tener entre 8 y 15 dígitos")
            if field == "copyCode" and len(value) > MAX_BUTTON_ID_LENGTH:
                raise HTTPException(400, f"El código para copiar admite máximo {MAX_BUTTON_ID_LENGTH} caracteres")
            if field == "id" and value in seen_ids:
                raise HTTPException(400, "Los IDs de respuesta deben ser únicos")
            seen_ids.add(value) if field == "id" else None
            result[field] = value
            normalized.append(result)
        values["interactive_config"] = {"title": title, "footer": footer, "buttons": normalized}
        return
    if interactive_type == "list":
        title = str(config.get("title") or "").strip()
        footer_text = str(config.get("footerText") or "").strip() or DEFAULT_INTERACTIVE_FOOTER
        button_text = str(config.get("buttonText") or "").strip()
        sections = config.get("sections") if isinstance(config.get("sections"), list) else []
        if not title or not button_text or not sections:
            raise HTTPException(400, "La lista requiere título, texto del botón y al menos una sección")
        if len(title) > MAX_INTERACTIVE_TITLE_LENGTH:
            raise HTTPException(400, f"El título interactivo admite máximo {MAX_INTERACTIVE_TITLE_LENGTH} caracteres")
        if len(footer_text) > MAX_INTERACTIVE_FOOTER_LENGTH:
            raise HTTPException(400, f"El pie de mensaje admite máximo {MAX_INTERACTIVE_FOOTER_LENGTH} caracteres")
        if len(button_text) > MAX_BUTTON_TEXT_LENGTH:
            raise HTTPException(400, f"El texto que abre la lista admite máximo {MAX_BUTTON_TEXT_LENGTH} caracteres")
        if len(sections) > 10:
            raise HTTPException(400, "Una lista admite como máximo 10 secciones")
        normalized_sections = []
        seen_section_titles: set[str] = set()
        seen_row_ids: set[str] = set()
        total_rows = 0
        for section in sections:
            section_title = str(section.get("title") or "").strip() if isinstance(section, dict) else ""
            rows = section.get("rows") if isinstance(section, dict) and isinstance(section.get("rows"), list) else []
            if not section_title or not rows or section_title.lower() in seen_section_titles:
                raise HTTPException(400, "Cada sección necesita un título único y al menos una opción")
            if len(section_title) > MAX_LIST_SECTION_TITLE_LENGTH:
                raise HTTPException(400, f"El título de sección admite máximo {MAX_LIST_SECTION_TITLE_LENGTH} caracteres")
            seen_section_titles.add(section_title.lower())
            normalized_rows = []
            for row in rows:
                row_title = str(row.get("title") or "").strip() if isinstance(row, dict) else ""
                row_id = str(row.get("rowId") or "").strip() if isinstance(row, dict) else ""
                description = str(row.get("description") or "").strip() if isinstance(row, dict) else ""
                if not row_title or not description or not row_id or row_id in seen_row_ids:
                    raise HTTPException(400, "Cada opción necesita título, descripción e ID único")
                if len(row_title) > MAX_LIST_ROW_TITLE_LENGTH:
                    raise HTTPException(400, f"El título de cada opción admite máximo {MAX_LIST_ROW_TITLE_LENGTH} caracteres")
                if len(description) > MAX_LIST_ROW_DESCRIPTION_LENGTH:
                    raise HTTPException(400, f"La descripción de cada opción admite máximo {MAX_LIST_ROW_DESCRIPTION_LENGTH} caracteres")
                if len(row_id) > MAX_LIST_ROW_ID_LENGTH:
                    raise HTTPException(400, f"El ID de cada opción admite máximo {MAX_LIST_ROW_ID_LENGTH} caracteres")
                seen_row_ids.add(row_id)
                normalized_rows.append({"title": row_title, "description": description, "rowId": row_id})
                total_rows += 1
            normalized_sections.append({"title": section_title, "rows": normalized_rows})
        if total_rows > 10:
            raise HTTPException(400, "Una lista admite como máximo 10 opciones")
        values["interactive_config"] = {
            "title": title, "footerText": footer_text, "buttonText": button_text,
            "sections": normalized_sections,
        }


def _validate_template_values(values: dict) -> dict:
    _normalize_and_validate_common(values)
    template_type = values.get("template_type", "internal")
    if template_type == "internal":
        values.update({
            "official_name": None,
            "official_language": None,
            "official_category": None,
            "official_status": None,
            "official_parameter_values": [],
        })
        _validate_interactive_config(values)
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
    if not values.get("official_category") or not values.get("official_status"):
        raise HTTPException(400, "Categoría y estado oficial son obligatorios")

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
    return values


@router.get("", response_model=list[TemplateItem])
async def get_templates(include_inactive: bool = False, user: User = Depends(get_current_user)):
    return await list_templates(user.id, include_inactive and user.role == "admin")


@router.get("/capabilities", response_model=TemplateCapabilities)
async def get_capabilities(_user: User = Depends(get_current_user)):
    try:
        return await get_template_capabilities()
    except EvolutionApiError as exc:
        return {
            "integration": None,
            "official_sending_supported": False,
            "reason": f"No se pudo comprobar la integración de Evolution API: {exc}",
        }


@router.post("", response_model=TemplateItem, status_code=201)
async def post_template(body: TemplateCreate, admin: User = Depends(require_admin)):
    values = body.model_dump()
    values = _validate_template_values(values)
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
    current = next((item for item in await list_templates(_admin.id, True) if item["id"] == template_id), None)
    if current is None:
        raise HTTPException(404, "Plantilla no encontrada")
    merged = {**current, **values}
    _validate_template_values(merged)
    if merged.get("interactive_type") != "none" and current["attachments"]:
        raise HTTPException(400, "Quita los adjuntos antes de convertir la plantilla en interactiva")
    for key in ("name", "content", "category", "shortcut"):
        if key in values:
            values[key] = merged[key]
    for key in (
        "official_name", "official_language", "official_category",
        "official_status", "official_parameter_values", "interactive_type", "interactive_config",
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

import asyncio
import logging
import re
from datetime import datetime

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from db.models import LeadStage as DbLeadStage, User
from models.schemas import (
    Chat,
    ChatPage,
    CustomerServiceWindow,
    KanbanPage,
    KanbanSnapshot,
    LeadCreate,
    LeadStage,
    LeadStageUpdate,
    LeadUpdate,
    Message,
    MessagePage,
    LeadActivityItem,
    SendLocationRequest,
    SendMediaRequest,
    SendMessageRequest,
    SendTemplateRequest,
    SellerItem,
)
from routers.media import save_media_file
from services.media_storage import MediaStorageError
from services.db_service import (
    CHATS_PAGE_SIZE,
    KANBAN_PAGE_SIZE,
    MESSAGES_PAGE_SIZE,
    LeadAlreadyExistsError,
    LeadHasMessagesError,
    create_lead,
    assign_tag,
    fetch_chat,
    fetch_chats,
    fetch_kanban_counts,
    fetch_kanban_snapshot,
    fetch_kanban_stage,
    fetch_messages,
    list_lead_activity,
    fetch_total_unread_chat_count,
    fetch_unread_wa_message_ids,
    lead_exists,
    mark_chat_read,
    list_active_sellers,
    get_customer_service_window,
    rekey_lead_phone,
    remove_tag,
    update_lead,
    update_lead_stage,
)
from services.auth_service import get_current_user
from services.evolution_service import (
    EvolutionApiError,
    check_whatsapp_numbers,
    mark_messages_as_read,
    mediatype_from_content_type as _mediatype_from_content_type,
)
from services.phone_utils import (
    PhoneValidationError,
    digits_to_jid,
    effective_country_code,
    normalize_phone,
)
from services.ws_manager import manager
from services.message_outbox import enqueue_messages, enqueue_text_message, retry_failed_message
from services.productivity_service import list_templates, record_template_use
from services.automation_service import trigger_lead_created, trigger_stage_changed

router = APIRouter(prefix="/api/chats", tags=["chats"])
logger = logging.getLogger(__name__)
DEFAULT_INTERACTIVE_FOOTER = "DermicaPro"


def _render_crm_value(value: str, chat: dict) -> str:
    values = {
        "nombre": chat.get("name") or "",
        "telefono": chat.get("phone") or "",
        "servicio": chat.get("servicio_interes") or "",
        "vendedor": chat.get("vendedor") or "",
        "fecha_actual": datetime.now().strftime("%d/%m/%Y"),
    }
    return re.sub(r"\{\{(\w+)\}\}", lambda match: values.get(match.group(1), match.group(0)), value)


def _render_interactive_config(value, chat: dict):
    if isinstance(value, str):
        return _render_crm_value(value, chat)
    if isinstance(value, list):
        return [_render_interactive_config(item, chat) for item in value]
    if isinstance(value, dict):
        return {key: _render_interactive_config(item, chat) for key, item in value.items()}
    return value


def _validate_rendered_interactive_message(interactive_type: str, description: str, config: dict) -> None:
    """Validate the final, lead-specific values before calling Evolution."""
    errors: list[str] = []
    title = str(config.get("title") or "").strip()
    footer = str(config.get("footer") or config.get("footerText") or DEFAULT_INTERACTIVE_FOOTER).strip()
    if not description.strip():
        errors.append("la descripción quedó vacía")
    elif len(description) > 1024:
        errors.append("la descripción supera 1024 caracteres")
    if not title:
        errors.append("el título quedó vacío")
    elif len(title) > 60:
        errors.append("el título supera 60 caracteres")
    if len(footer) > 60:
        errors.append("el pie supera 60 caracteres")

    if interactive_type == "buttons":
        for index, button in enumerate(config.get("buttons", []), start=1):
            label = str(button.get("displayText") or "").strip()
            if not label or len(label) > 20:
                errors.append(f"el texto del botón {index} debe tener entre 1 y 20 caracteres")
            button_type = button.get("type")
            if button_type == "url":
                url = str(button.get("url") or "").strip()
                if not re.fullmatch(r"https://[^\s]{1,2040}", url, flags=re.IGNORECASE):
                    errors.append(f"la URL del botón {index} no es válida")
            elif button_type == "call":
                phone = re.sub(r"[\s()\-]", "", str(button.get("phoneNumber") or ""))
                if not re.fullmatch(r"\+?[1-9]\d{7,14}", phone):
                    errors.append(f"el teléfono del botón {index} no es válido")
    else:
        button_text = str(config.get("buttonText") or "").strip()
        if not button_text or len(button_text) > 20:
            errors.append("el texto que abre la lista debe tener entre 1 y 20 caracteres")
        for section_index, section in enumerate(config.get("sections", []), start=1):
            section_title = str(section.get("title") or "").strip()
            if not section_title or len(section_title) > 24:
                errors.append(f"el título de la sección {section_index} debe tener entre 1 y 24 caracteres")
            for row_index, row in enumerate(section.get("rows", []), start=1):
                row_title = str(row.get("title") or "").strip()
                row_description = str(row.get("description") or "").strip()
                row_id = str(row.get("rowId") or "").strip()
                prefix = f"la opción {row_index} de la sección {section_index}"
                if not row_title or len(row_title) > 24:
                    errors.append(f"{prefix} necesita un título de máximo 24 caracteres")
                if not row_description or len(row_description) > 72:
                    errors.append(f"{prefix} necesita una descripción de máximo 72 caracteres")
                if not row_id or len(row_id) > 200:
                    errors.append(f"{prefix} necesita un ID de máximo 200 caracteres")

    if errors:
        raise HTTPException(400, "La plantilla no se puede enviar: " + "; ".join(errors))

# Mapea los nombres de campo de la API (schemas.Chat) a las columnas reales de
# la tabla leads (db.models.Lead) para armar el dict de `update_lead`.
_LEAD_FIELD_TO_COLUMN = {
    "phone": "telefono",
    "name": "nombre",
    "servicio_interes": "servicio_interes",
    "vendedor_id": "vendedor_id",
    "origen": "origen",
    "notas": "notas",
}


async def _require_existing_lead(chat_id: str) -> None:
    if not await lead_exists(chat_id):
        raise HTTPException(404, "Lead no encontrado")


@router.get("", response_model=ChatPage)
async def get_chats(
    search: str | None = None,
    cursor_ts: str | None = None,
    cursor_id: str | None = None,
    limit: int = CHATS_PAGE_SIZE,
    unread_only: bool = False,
    stages: str | None = None,
    tag_ids: str | None = None,
    tag_mode: str = Query(default="any", pattern="^(any|all)$"),
    service: str | None = None,
    seller_id: int | None = Query(default=None, ge=1),
    origin: str | None = None,
    last_sender: str | None = Query(default=None, pattern="^(cliente|vendedor)$"),
    inactive_days: int | None = Query(default=None, ge=1, le=3650),
    waiting_time: str | None = Query(default=None, pattern="^(any|fresh|warning|urgent)$"),
    cursor_rank: int | None = Query(default=None, ge=0, le=2),
):
    try:
        parsed_stages = [DbLeadStage(value) for value in stages.split(",") if value] if stages else None
        parsed_tag_ids = [int(value) for value in tag_ids.split(",") if value] if tag_ids else None
        return await fetch_chats(
            search.strip() if search else None,
            cursor_ts,
            cursor_id,
            limit,
            unread_only,
            parsed_stages,
            parsed_tag_ids,
            tag_mode,
            service,
            seller_id,
            origin,
            last_sender,
            inactive_days,
            waiting_time,
            cursor_rank,
        )
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="Filtros inválidos")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/unread-count")
async def get_unread_count():
    """Cantidad de chats no leídos; solo baja al marcar uno como visto."""
    return {"count": await fetch_total_unread_chat_count()}


@router.get("/kanban/counts", response_model=dict[LeadStage, int])
async def get_kanban_counts(search: str | None = None):
    return await fetch_kanban_counts(search.strip() if search else None)


@router.get("/kanban/snapshot", response_model=KanbanSnapshot)
async def get_kanban_snapshot(search: str | None = None):
    return await fetch_kanban_snapshot(search.strip() if search else None)


@router.get("/kanban/{stage}", response_model=KanbanPage)
async def get_kanban_stage(
    stage: LeadStage,
    search: str | None = None,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=KANBAN_PAGE_SIZE, ge=1, le=100),
):
    return await fetch_kanban_stage(
        DbLeadStage(stage),
        search.strip() if search else None,
        offset,
        limit,
    )


@router.patch("/{chat_id}/stage", response_model=Chat)
async def move_chat_stage(chat_id: str, body: LeadStageUpdate, user: User = Depends(get_current_user)):
    previous = await fetch_chat(chat_id)
    lead = await update_lead_stage(chat_id, DbLeadStage(body.stage), "user", user.id)
    if lead is None:
        raise HTTPException(status_code=404, detail="Lead no encontrado")

    await manager.broadcast({"type": "chats_updated", "chat_id": chat_id, "reason": "stage_changed"})
    if previous and previous["stage"] != body.stage:
        try:
            await trigger_stage_changed(chat_id)
        except Exception:
            logger.exception("No se pudo programar la automatización de cambio de etapa")
    return lead


async def _verify_whatsapp_number(digits: str) -> tuple[bool | None, str | None]:
    """(existe, jid canónico). existe=None significa que no se pudo verificar
    (Evolution caída o sin configurar): se sigue adelante igual — bloquear el
    alta de leads porque WhatsApp está desconectado dejaría el CRM inusable."""
    try:
        rows = await check_whatsapp_numbers([digits])
    except (EvolutionApiError, httpx.HTTPError):
        logger.warning("No se pudo verificar el número %s en WhatsApp; se continúa igual", digits, exc_info=True)
        return None, None
    row = rows[0] if rows and isinstance(rows[0], dict) else None
    if row is None:
        return None, None
    jid = row.get("jid")
    if not (isinstance(jid, str) and jid.endswith("@s.whatsapp.net")):
        jid = None
    return bool(row.get("exists")), jid


@router.post("", response_model=Chat, status_code=201)
async def create_chat(body: LeadCreate, user: User = Depends(get_current_user)):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="El nombre es obligatorio")
    try:
        digits = normalize_phone(body.phone, await effective_country_code())
    except PhoneValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    if user.role != "admin" and body.vendedor_id not in (None, user.id):
        raise HTTPException(status_code=403, detail="Solo un administrador puede asignar otro vendedor")

    exists_wa, canonical_jid = await _verify_whatsapp_number(digits)
    if exists_wa is False:
        raise HTTPException(status_code=422, detail="Ese número no tiene WhatsApp. Revisalo e intentá de nuevo.")

    try:
        lead = await create_lead(
            phone=digits,
            name=name,
            servicio_interes=body.servicio_interes,
            vendedor_id=body.vendedor_id,
            origen=body.origen,
            notas=body.notas,
            actor_user_id=user.id,
            remote_jid=canonical_jid,
        )
    except LeadAlreadyExistsError:
        raise HTTPException(status_code=409, detail="Ya existe un contacto con ese teléfono")
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    await manager.broadcast({"type": "chats_updated", "chat_id": lead["chat_id"], "reason": "lead_created"})
    try:
        await trigger_lead_created(lead["chat_id"])
    except Exception:
        logger.exception("No se pudo programar la automatización de lead nuevo")
    return lead


@router.patch("/{chat_id}", response_model=Chat)
async def update_chat(chat_id: str, body: LeadUpdate, user: User = Depends(get_current_user)):
    if "vendedor_id" in body.model_fields_set and user.role != "admin" and body.vendedor_id != user.id:
        raise HTTPException(status_code=403, detail="Solo un administrador puede reasignar o quitar el vendedor")
    values = {
        _LEAD_FIELD_TO_COLUMN[k]: v for k, v in body.model_dump(exclude_unset=True).items()
    }

    # El teléfono es la identidad del chat (remote_jid): no se puede vaciar y
    # cambiarlo exige re-key. Un phone: null explícito se ignora.
    new_phone = values.pop("telefono", None)
    if new_phone:
        try:
            digits = normalize_phone(new_phone, await effective_country_code())
        except PhoneValidationError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        new_jid = digits_to_jid(digits)
        if new_jid != chat_id:
            exists_wa, canonical_jid = await _verify_whatsapp_number(digits)
            if exists_wa is False:
                raise HTTPException(status_code=422, detail="Ese número no tiene WhatsApp. Revisalo e intentá de nuevo.")
            try:
                rekeyed = await rekey_lead_phone(chat_id, digits, canonical_jid or new_jid, user.id)
            except LeadHasMessagesError:
                raise HTTPException(
                    status_code=409,
                    detail="No se puede cambiar el teléfono: el lead ya tiene conversación en WhatsApp",
                )
            except LeadAlreadyExistsError:
                raise HTTPException(status_code=409, detail="Ya existe un contacto con ese teléfono")
            if rekeyed is None:
                raise HTTPException(status_code=404, detail="Lead no encontrado")
            chat_id = rekeyed["chat_id"]
        else:
            values["telefono"] = f"+{digits}"

    try:
        lead = await update_lead(chat_id, values, "user", user.id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    if lead is None:
        raise HTTPException(status_code=404, detail="Lead no encontrado")

    await manager.broadcast({"type": "chats_updated", "chat_id": chat_id, "reason": "lead_updated"})
    return lead


@router.get("/sellers", response_model=list[SellerItem])
async def get_sellers():
    return await list_active_sellers()


@router.get("/phone-config")
async def get_phone_config():
    """Código de país por defecto para el form de leads. Existe aparte de
    /api/settings porque aquel es admin-only y los vendedores también crean
    leads."""
    return {"default_country_code": await effective_country_code()}


@router.get("/{chat_id}", response_model=Chat)
async def get_chat(chat_id: str):
    chat = await fetch_chat(chat_id)
    if chat is None:
        raise HTTPException(status_code=404, detail="Lead no encontrado")
    return chat


@router.post("/{chat_id}/tags/{tag_id}", response_model=Chat)
async def add_chat_tag(chat_id: str, tag_id: int, user: User = Depends(get_current_user)):
    if not await assign_tag(chat_id, tag_id, user.id):
        raise HTTPException(status_code=404, detail="Lead o etiqueta no encontrados")
    await manager.broadcast({"type": "chats_updated", "chat_id": chat_id, "reason": "tag_changed"})
    return await fetch_chat(chat_id)


@router.delete("/{chat_id}/tags/{tag_id}", response_model=Chat)
async def delete_chat_tag(chat_id: str, tag_id: int, user: User = Depends(get_current_user)):
    if not await remove_tag(chat_id, tag_id, user.id):
        raise HTTPException(status_code=404, detail="La etiqueta no está asignada")
    await manager.broadcast({"type": "chats_updated", "chat_id": chat_id, "reason": "tag_changed"})
    return await fetch_chat(chat_id)


@router.get("/{chat_id}/activity", response_model=list[LeadActivityItem])
async def get_chat_activity(chat_id: str, limit: int = Query(default=50, ge=1, le=200)):
    return await list_lead_activity(chat_id, limit)


@router.get("/{chat_id}/messages", response_model=MessagePage)
async def get_messages(
    chat_id: str,
    cursor_ts: datetime | None = None,
    cursor_id: int | None = Query(default=None, ge=1),
    limit: int = Query(default=MESSAGES_PAGE_SIZE, ge=1, le=100),
    until_id: int | None = Query(default=None, ge=1),
):
    try:
        return await fetch_messages(chat_id, cursor_ts, cursor_id, limit, until_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{chat_id}/service-window", response_model=CustomerServiceWindow)
async def get_service_window(chat_id: str):
    window = await get_customer_service_window(chat_id)
    if window is None:
        raise HTTPException(404, "Lead no encontrado")
    return window


@router.post("/{chat_id}/messages", response_model=Message)
async def send_message(chat_id: str, body: SendMessageRequest):
    text = body.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="El mensaje no puede estar vacío")
    await _require_existing_lead(chat_id)
    message = await enqueue_text_message(chat_id, text)
    await manager.broadcast({"type": "chats_updated", "chat_id": chat_id, "reason": "outbound_queued"})
    return message


@router.post("/{chat_id}/audio", response_model=Message)
async def send_audio(chat_id: str, body: SendMediaRequest):
    """Guarda y encola una nota de voz (PTT) sin esperar a Evolution."""
    await _require_existing_lead(chat_id)
    try:
        media_url = await asyncio.to_thread(save_media_file, body.content_type, body.data_base64)
    except ValueError as e:
        status = 413 if "grande" in str(e) else 400
        raise HTTPException(status_code=status, detail=str(e))
    except MediaStorageError as e:
        raise HTTPException(status_code=503, detail=str(e))

    message = (await enqueue_messages(chat_id, [{
        "content": "<audio></audio>",
        "media_url": media_url,
        "payload": {"type": "audio", "media_url": media_url},
    }]))[0]
    await manager.broadcast({"type": "chats_updated", "chat_id": chat_id, "reason": "outbound_queued"})
    return message


@router.post("/{chat_id}/media", response_model=Message)
async def send_media(chat_id: str, body: SendMediaRequest):
    """Guarda y encola un adjunto sin esperar a Evolution."""
    await _require_existing_lead(chat_id)
    mediatype = _mediatype_from_content_type(body.content_type)
    if mediatype not in ("image", "video", "audio", "document"):
        raise HTTPException(status_code=400, detail="Tipo de archivo no soportado")

    try:
        media_url = await asyncio.to_thread(
            save_media_file, body.content_type, body.data_base64, body.filename
        )
    except ValueError as e:
        status = 413 if "grande" in str(e) else 400
        raise HTTPException(status_code=status, detail=str(e))
    except MediaStorageError as e:
        raise HTTPException(status_code=503, detail=str(e))

    # El frontend solo reconoce las etiquetas image/video/audio; cualquier
    # otra cosa (documentos) se muestra como adjunto genérico. Para
    # documentos se guarda el nombre real adentro del tag —a diferencia de
    # audio/imagen/video, WhatsApp no tiene "caption" para documentos, así
    # que ese lugar queda libre para el nombre del archivo.
    tag = mediatype if mediatype in ("image", "video", "audio") else "other"
    content = f"<{tag}>{body.filename}</{tag}>" if tag == "other" and body.filename else f"<{tag}></{tag}>"
    message = (await enqueue_messages(chat_id, [{
        "content": content,
        "media_url": media_url,
        "payload": {
            "type": "media",
            "media_url": media_url,
            "mediatype": mediatype,
            "filename": body.filename,
        },
    }]))[0]
    await manager.broadcast({"type": "chats_updated", "chat_id": chat_id, "reason": "outbound_queued"})
    return message


@router.post("/{chat_id}/templates/{template_id}", response_model=list[Message])
async def send_template(
    chat_id: str,
    template_id: int,
    body: SendTemplateRequest,
    user: User = Depends(get_current_user),
):
    template = next((item for item in await list_templates(user.id) if item["id"] == template_id), None)
    if template is None:
        raise HTTPException(404, "Plantilla no encontrada")
    text = body.text.strip() if body.text else ""

    if template["template_type"] == "official":
        if template["official_status"] != "APPROVED":
            raise HTTPException(409, "Solo se pueden enviar plantillas oficiales con estado APPROVED")
        expected_parameters = template["official_parameter_values"]
        parameters = [value.strip() for value in body.parameters]
        if len(parameters) != len(expected_parameters) or any(not value for value in parameters):
            raise HTTPException(400, "Los parámetros no coinciden con las variables de la plantilla oficial")
        components = []
        if parameters:
            components.append({
                "type": "body",
                "parameters": [{"type": "text", "text": value} for value in parameters],
            })
        message = (await enqueue_messages(chat_id, [{
            "content": text or template["content"],
            "payload": {
                "type": "official_template",
                "name": template["official_name"],
                "language": template["official_language"],
                "components": components,
            },
        }]))[0]
        await record_template_use(template_id, user.id)
        await manager.broadcast({"type": "chats_updated", "chat_id": chat_id, "reason": "outbound_queued"})
        return [message]

    await _require_existing_lead(chat_id)
    if template["interactive_type"] != "none":
        chat = await fetch_chat(chat_id)
        if chat is None:
            raise HTTPException(404, "Lead no encontrado")
        config = _render_interactive_config(template["interactive_config"], chat)
        description = text or _render_crm_value(template["content"], chat)
        _validate_rendered_interactive_message(template["interactive_type"], description, config)
        choices = (
            " · ".join(button["displayText"] for button in config["buttons"])
            if template["interactive_type"] == "buttons"
            else " · ".join(row["title"] for section in config["sections"] for row in section["rows"])
        )
        content = f"{config['title']}\n{description}\nOpciones: {choices}"
        message = (await enqueue_messages(chat_id, [{
            "content": content,
            "payload": {
                "type": "interactive",
                "interactive_type": template["interactive_type"],
                "description": description,
                "config": config,
            },
        }]))[0]
        await record_template_use(template_id, user.id)
        await manager.broadcast({"type": "chats_updated", "chat_id": chat_id, "reason": "outbound_queued"})
        return [message]

    if not text and not template["attachments"]:
        raise HTTPException(400, "La plantilla no tiene contenido para enviar")
    if len(text) > 4096:
        raise HTTPException(400, "El texto de la plantilla supera el máximo de 4096 caracteres")

    items: list[dict] = []
    if text:
        items.append({"content": text, "payload": {"type": "text", "text": text}})
    for attachment in template["attachments"]:
        mediatype = _mediatype_from_content_type(attachment["content_type"])
        tag = mediatype if mediatype in ("image", "video", "audio") else "other"
        content = f"<{tag}>{attachment['filename'] if tag == 'other' else ''}</{tag}>"
        items.append({
            "content": content,
            "media_url": attachment["media_url"],
            "payload": {
                "type": "media",
                "media_url": attachment["media_url"],
                "mediatype": mediatype,
                "filename": attachment["filename"],
            },
        })
    sent = await enqueue_messages(chat_id, items)
    await record_template_use(template_id, user.id)
    await manager.broadcast({"type": "chats_updated", "chat_id": chat_id, "reason": "outbound_queued"})
    return sent


@router.post("/{chat_id}/location", response_model=Message)
async def send_location(chat_id: str, body: SendLocationRequest):
    await _require_existing_lead(chat_id)
    content = f"<location>{body.latitude},{body.longitude}</location>"
    message = (await enqueue_messages(chat_id, [{
        "content": content,
        "payload": {
            "type": "location",
            "latitude": body.latitude,
            "longitude": body.longitude,
        },
    }]))[0]
    await manager.broadcast({"type": "chats_updated", "chat_id": chat_id, "reason": "outbound_queued"})
    return message


@router.post("/{chat_id}/messages/{message_id}/retry", response_model=Message)
async def retry_message(chat_id: str, message_id: int):
    message = await retry_failed_message(chat_id, message_id)
    if message is None:
        raise HTTPException(409, "El mensaje no está fallido o ya fue reintentado")
    await manager.broadcast({"type": "chats_updated", "chat_id": chat_id, "reason": "outbound_queued"})
    return message


@router.post("/{chat_id}/read")
async def read_chat(chat_id: str):
    """Marca el chat como visto por el vendedor — resetea unread_count a 0 y
    le avisa a WhatsApp (tiques azules del lado del cliente) de los mensajes
    que todavía no se habían marcado como leídos."""
    wa_message_ids = await fetch_unread_wa_message_ids(chat_id)
    if wa_message_ids:
        try:
            await mark_messages_as_read(chat_id, wa_message_ids)
        except (EvolutionApiError, httpx.HTTPError) as exc:
            # Best-effort: si Evolution falla (no configurada, mensaje ya no
            # existe del lado de WhatsApp, etc.) igual se marca como visto
            # de nuestro lado — no tiene sentido bloquear el badge interno
            # por un problema ajeno a nuestra base.
            logger.warning(
                "No se pudieron marcar %d mensajes como leídos en Evolution API para %s: %s",
                len(wa_message_ids),
                chat_id,
                exc,
            )

    await mark_chat_read(chat_id)
    await manager.broadcast({"type": "chats_updated", "chat_id": chat_id, "reason": "read"})
    return {"status": "ok"}

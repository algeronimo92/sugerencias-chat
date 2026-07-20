import base64
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
from routers.media import MEDIA_DIR, save_media_file
from services.db_service import (
    CHATS_PAGE_SIZE,
    KANBAN_PAGE_SIZE,
    MESSAGES_PAGE_SIZE,
    LeadAlreadyExistsError,
    create_lead,
    assign_tag,
    fetch_chat,
    fetch_chats,
    fetch_kanban_counts,
    fetch_kanban_stage,
    fetch_messages,
    list_lead_activity,
    fetch_total_unread_chat_count,
    fetch_unread_wa_message_ids,
    insert_message,
    mark_chat_read,
    list_active_sellers,
    get_customer_service_window,
    remove_tag,
    update_lead,
    update_lead_stage,
)
from services.auth_service import get_current_user
from services.evolution_service import (
    EvolutionApiError,
    mark_messages_as_read,
    mediatype_from_content_type as _mediatype_from_content_type,
    send_whatsapp_audio,
    send_whatsapp_buttons,
    send_whatsapp_list,
    send_whatsapp_location,
    send_whatsapp_media,
    send_whatsapp_template,
    send_whatsapp_text,
    get_template_capabilities,
)
from services.ws_manager import manager
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


def _is_baileys_list_serialization_error(exc: Exception) -> bool:
    """Detect the known Baileys/long failure before a legacy list is sent."""
    return "this.isZero is not a function" in str(exc)


def _list_text_fallback(title: str, description: str, footer: str, sections: list[dict]) -> str:
    """Keep a list usable when the installed Evolution/Baileys cannot serialize it."""
    lines: list[str] = []
    if title:
        lines.append(f"*{title}*")
    if description:
        lines.append(description)

    option_number = 1
    for section in sections:
        section_title = (section.get("title") or "").strip()
        if section_title:
            lines.extend(["", f"*{section_title}*"])
        for row in section.get("rows", []):
            row_title = (row.get("title") or "").strip()
            row_description = (row.get("description") or "").strip()
            option = f"{option_number}. {row_title}"
            if row_description:
                option += f" — {row_description}"
            lines.append(option)
            option_number += 1

    lines.extend(["", "Responde con el número de la opción que deseas."])
    if footer:
        lines.extend(["", footer])
    return "\n".join(lines)


def _buttons_text_fallback(title: str, description: str, footer: str, buttons: list[dict]) -> str:
    """Render buttons as a deliverable text message for unreliable Baileys versions."""
    lines = [f"*{title}*", description]
    reply_only = all(button.get("type") == "reply" for button in buttons)
    lines.append("")
    for index, button in enumerate(buttons, start=1):
        label = str(button.get("displayText") or "").strip()
        button_type = button.get("type")
        if button_type == "reply":
            lines.append(f"{index}. {label}")
        elif button_type == "url":
            lines.append(f"• {label}: {button.get('url', '')}")
        elif button_type == "call":
            lines.append(f"• {label}: {button.get('phoneNumber', '')}")
        else:
            lines.append(f"• {label}: {button.get('copyCode', '')}")
    if reply_only:
        lines.extend(["", "Responde con el número de la opción que deseas."])
    if footer:
        lines.extend(["", footer])
    return "\n".join(lines)


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


def _wa_message_id(evolution_response: dict) -> str | None:
    """El id de WhatsApp (key.id) que Evolution API devuelve al mandar un
    mensaje — se guarda para poder matchear después los eventos de estado
    (entregado/leído). Se accede con .get anidados porque el shape exacto
    de la respuesta no está documentado de forma confiable."""
    key = evolution_response.get("key")
    return key.get("id") if isinstance(key, dict) else None


async def _require_existing_lead(chat_id: str) -> None:
    if await get_customer_service_window(chat_id) is None:
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
):
    try:
        parsed_stages = [DbLeadStage(value) for value in stages.split(",") if value] if stages else None
        parsed_tag_ids = [int(value) for value in tag_ids.split(",") if value] if tag_ids else None
        return await fetch_chats(
            search,
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

    await manager.broadcast({"type": "chats_updated"})
    if previous and previous["stage"] != body.stage:
        try:
            await trigger_stage_changed(chat_id)
        except Exception:
            logger.exception("No se pudo programar la automatización de cambio de etapa")
    return lead


@router.post("", response_model=Chat, status_code=201)
async def create_chat(body: LeadCreate, user: User = Depends(get_current_user)):
    phone = body.phone.strip()
    name = body.name.strip()
    if not phone:
        raise HTTPException(status_code=400, detail="El teléfono es obligatorio")
    if not name:
        raise HTTPException(status_code=400, detail="El nombre es obligatorio")

    if user.role != "admin" and body.vendedor_id not in (None, user.id):
        raise HTTPException(status_code=403, detail="Solo un administrador puede asignar otro vendedor")
    try:
        lead = await create_lead(
            phone=phone,
            name=name,
            servicio_interes=body.servicio_interes,
            vendedor_id=body.vendedor_id,
            origen=body.origen,
            notas=body.notas,
            actor_user_id=user.id,
        )
    except LeadAlreadyExistsError:
        raise HTTPException(status_code=409, detail="Ya existe un contacto con ese teléfono")
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    await manager.broadcast({"type": "chats_updated"})
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
    try:
        lead = await update_lead(chat_id, values, "user", user.id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    if lead is None:
        raise HTTPException(status_code=404, detail="Lead no encontrado")

    await manager.broadcast({"type": "chats_updated"})
    return lead


@router.get("/sellers", response_model=list[SellerItem])
async def get_sellers():
    return await list_active_sellers()


@router.post("/{chat_id}/tags/{tag_id}", response_model=Chat)
async def add_chat_tag(chat_id: str, tag_id: int, user: User = Depends(get_current_user)):
    if not await assign_tag(chat_id, tag_id, user.id):
        raise HTTPException(status_code=404, detail="Lead o etiqueta no encontrados")
    await manager.broadcast({"type": "chats_updated"})
    return await fetch_chat(chat_id)


@router.delete("/{chat_id}/tags/{tag_id}", response_model=Chat)
async def delete_chat_tag(chat_id: str, tag_id: int, user: User = Depends(get_current_user)):
    if not await remove_tag(chat_id, tag_id, user.id):
        raise HTTPException(status_code=404, detail="La etiqueta no está asignada")
    await manager.broadcast({"type": "chats_updated"})
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
):
    try:
        return await fetch_messages(chat_id, cursor_ts, cursor_id, limit)
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
    try:
        evolution_response = await send_whatsapp_text(chat_id, text)
    except EvolutionApiError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Error llamando a Evolution API: {e}")

    message = await insert_message(
        chat_id, sender="vendedor", content=text, wa_message_id=_wa_message_id(evolution_response), status="SERVER_ACK"
    )
    await manager.broadcast({"type": "chats_updated"})
    return message


@router.post("/{chat_id}/audio", response_model=Message)
async def send_audio(chat_id: str, body: SendMediaRequest):
    """Nota de voz grabada en vivo (PTT) — endpoint sendWhatsAppAudio."""
    await _require_existing_lead(chat_id)
    try:
        media_url = save_media_file(body.content_type, body.data_base64)
    except ValueError as e:
        status = 413 if "grande" in str(e) else 400
        raise HTTPException(status_code=status, detail=str(e))

    try:
        evolution_response = await send_whatsapp_audio(chat_id, body.data_base64)
    except EvolutionApiError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Error llamando a Evolution API: {e}")

    message = await insert_message(
        chat_id,
        sender="vendedor",
        content="<audio></audio>",
        media_url=media_url,
        wa_message_id=_wa_message_id(evolution_response),
        status="SERVER_ACK",
    )
    await manager.broadcast({"type": "chats_updated"})
    return message


@router.post("/{chat_id}/media", response_model=Message)
async def send_media(chat_id: str, body: SendMediaRequest):
    """Adjuntar un archivo ya existente — imagen, video, audio (como archivo,
    no nota de voz) o documento — vía sendMedia."""
    await _require_existing_lead(chat_id)
    mediatype = _mediatype_from_content_type(body.content_type)
    if mediatype not in ("image", "video", "audio", "document"):
        raise HTTPException(status_code=400, detail="Tipo de archivo no soportado")

    try:
        media_url = save_media_file(body.content_type, body.data_base64, filename=body.filename)
    except ValueError as e:
        status = 413 if "grande" in str(e) else 400
        raise HTTPException(status_code=status, detail=str(e))

    try:
        evolution_response = await send_whatsapp_media(chat_id, body.data_base64, mediatype, filename=body.filename)
    except EvolutionApiError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Error llamando a Evolution API: {e}")

    # El frontend solo reconoce las etiquetas image/video/audio; cualquier
    # otra cosa (documentos) se muestra como adjunto genérico. Para
    # documentos se guarda el nombre real adentro del tag —a diferencia de
    # audio/imagen/video, WhatsApp no tiene "caption" para documentos, así
    # que ese lugar queda libre para el nombre del archivo.
    tag = mediatype if mediatype in ("image", "video", "audio") else "other"
    content = f"<{tag}>{body.filename}</{tag}>" if tag == "other" and body.filename else f"<{tag}></{tag}>"
    message = await insert_message(
        chat_id,
        sender="vendedor",
        content=content,
        media_url=media_url,
        wa_message_id=_wa_message_id(evolution_response),
        status="SERVER_ACK",
    )
    await manager.broadcast({"type": "chats_updated"})
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
        try:
            response = await send_whatsapp_template(
                chat_id,
                template["official_name"],
                template["official_language"],
                components,
            )
        except (EvolutionApiError, httpx.HTTPError) as exc:
            raise HTTPException(502, detail=f"No se pudo enviar la plantilla oficial: {exc}")
        message = await insert_message(
            chat_id,
            sender="vendedor",
            content=text or template["content"],
            wa_message_id=_wa_message_id(response),
            status="SERVER_ACK",
        )
        await record_template_use(template_id, user.id)
        await manager.broadcast({"type": "chats_updated"})
        return [message]

    await _require_existing_lead(chat_id)
    if template["interactive_type"] != "none":
        chat = await fetch_chat(chat_id)
        if chat is None:
            raise HTTPException(404, "Lead no encontrado")
        config = _render_interactive_config(template["interactive_config"], chat)
        description = text or _render_crm_value(template["content"], chat)
        _validate_rendered_interactive_message(template["interactive_type"], description, config)
        fallback_content: str | None = None
        try:
            capabilities = await get_template_capabilities()
            integration = capabilities.get("integration")
        except (EvolutionApiError, httpx.HTTPError) as exc:
            # Native interactive messages can return success without reaching
            # WhatsApp on Baileys. If the adapter cannot be verified, prefer a
            # normal text message whose delivery path is known to work.
            logger.warning("Could not detect Evolution adapter; using safe interactive fallback: %s", exc)
            integration = None
        use_safe_text = integration != "WHATSAPP-BUSINESS"
        try:
            if use_safe_text and template["interactive_type"] == "buttons":
                fallback_content = _buttons_text_fallback(
                    config["title"], description,
                    config.get("footer") or DEFAULT_INTERACTIVE_FOOTER,
                    config["buttons"],
                )
                response = await send_whatsapp_text(chat_id, fallback_content)
            elif use_safe_text:
                fallback_content = _list_text_fallback(
                    config["title"], description,
                    config.get("footerText") or DEFAULT_INTERACTIVE_FOOTER,
                    config["sections"],
                )
                response = await send_whatsapp_text(chat_id, fallback_content)
            elif template["interactive_type"] == "buttons":
                response = await send_whatsapp_buttons(
                    chat_id,
                    config["title"],
                    description,
                    config.get("footer") or DEFAULT_INTERACTIVE_FOOTER,
                    config["buttons"],
                )
                choices = " · ".join(button["displayText"] for button in config["buttons"])
            else:
                try:
                    response = await send_whatsapp_list(
                        chat_id, config["title"], description,
                        config.get("footerText") or DEFAULT_INTERACTIVE_FOOTER,
                        config["buttonText"], config["sections"],
                    )
                except EvolutionApiError as exc:
                    if not _is_baileys_list_serialization_error(exc):
                        raise
                    # Evolution/Baileys failed while serializing the legacy list,
                    # before WhatsApp received it. Send one text message instead;
                    # never retry the broken list request and risk a duplicate.
                    fallback_content = _list_text_fallback(
                        config["title"], description,
                        config.get("footerText") or DEFAULT_INTERACTIVE_FOOTER,
                        config["sections"],
                    )
                    logger.warning(
                        "Evolution/Baileys could not serialize list template %s; using numbered text fallback",
                        template_id,
                    )
                    response = await send_whatsapp_text(chat_id, fallback_content)
                choices = " · ".join(
                    row["title"] for section in config["sections"] for row in section["rows"]
                )
        except (EvolutionApiError, httpx.HTTPError) as exc:
            raise HTTPException(502, detail=f"No se pudo enviar el mensaje interactivo: {exc}")
        if fallback_content is None:
            content = f"{config['title']}\n{description}\nOpciones: {choices}"
        else:
            content = fallback_content
        message = await insert_message(
            chat_id, sender="vendedor", content=content,
            wa_message_id=_wa_message_id(response), status="SERVER_ACK",
        )
        await record_template_use(template_id, user.id)
        await manager.broadcast({"type": "chats_updated"})
        return [message]

    if not text and not template["attachments"]:
        raise HTTPException(400, "La plantilla no tiene contenido para enviar")
    if len(text) > 4096:
        raise HTTPException(400, "El texto de la plantilla supera el máximo de 4096 caracteres")

    sent: list[dict] = []
    try:
        if text:
            response = await send_whatsapp_text(chat_id, text)
            sent.append(await insert_message(
                chat_id, sender="vendedor", content=text, wa_message_id=_wa_message_id(response), status="SERVER_ACK"
            ))
        for attachment in template["attachments"]:
            path = (MEDIA_DIR / attachment["media_url"].rsplit("/", 1)[-1]).resolve()
            if path.parent != MEDIA_DIR.resolve() or not path.is_file():
                raise EvolutionApiError(f"No se encontró el adjunto {attachment['filename']}")
            encoded = base64.b64encode(path.read_bytes()).decode("ascii")
            mediatype = _mediatype_from_content_type(attachment["content_type"])
            response = await send_whatsapp_media(
                chat_id, encoded, mediatype, filename=attachment["filename"]
            )
            tag = mediatype if mediatype in ("image", "video", "audio") else "other"
            content = f"<{tag}>{attachment['filename'] if tag == 'other' else ''}</{tag}>"
            sent.append(await insert_message(
                chat_id, sender="vendedor", content=content, media_url=attachment["media_url"],
                wa_message_id=_wa_message_id(response), status="SERVER_ACK",
            ))
    except (EvolutionApiError, httpx.HTTPError) as exc:
        if sent:
            await manager.broadcast({"type": "chats_updated"})
        raise HTTPException(502, detail=f"Envío parcial: se enviaron {len(sent)} elementos. {exc}")

    await record_template_use(template_id, user.id)
    await manager.broadcast({"type": "chats_updated"})
    return sent


@router.post("/{chat_id}/location", response_model=Message)
async def send_location(chat_id: str, body: SendLocationRequest):
    await _require_existing_lead(chat_id)
    try:
        evolution_response = await send_whatsapp_location(chat_id, body.latitude, body.longitude)
    except EvolutionApiError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Error llamando a Evolution API: {e}")

    content = f"<location>{body.latitude},{body.longitude}</location>"
    message = await insert_message(
        chat_id, sender="vendedor", content=content, wa_message_id=_wa_message_id(evolution_response), status="SERVER_ACK"
    )
    await manager.broadcast({"type": "chats_updated"})
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
    await manager.broadcast({"type": "chats_updated"})
    return {"status": "ok"}

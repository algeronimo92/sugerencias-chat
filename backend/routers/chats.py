import asyncio
import base64
import logging
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from db.models import LeadStage as DbLeadStage, User
from models.schemas import (
    Chat,
    ChatPage,
    CustomerServiceWindow,
    EditMessageRequest,
    ForwardMessagesRequest,
    ForwardMessagesResponse,
    HistoryPage,
    KanbanPage,
    KanbanSnapshot,
    LeadCreate,
    LeadMergeRequest,
    LeadStage,
    LeadStageUpdate,
    LeadUpdate,
    Message,
    MessagePage,
    LeadActivityItem,
    PinnedMessagesResponse,
    ReactionRequest,
    StickerRequest,
    SendLocationRequest,
    SendMediaRequest,
    SendMessageRequest,
    SendTemplateRequest,
    SellerItem,
)
from services.media_upload import save_decoded_media, save_media_file
from services.media_storage import (
    AudioTranscodeError,
    MediaStorageError,
    transcode_audio_to_ogg_opus,
)
from services.media_library_service import get_media_asset
from services.db_service import (
    CHATS_PAGE_SIZE,
    KANBAN_PAGE_SIZE,
    MESSAGES_PAGE_SIZE,
    LeadAlreadyExistsError,
    create_lead,
    assign_tag,
    delete_lead,
    fetch_chat,
    fetch_chats,
    fetch_messages_to_forward,
    filter_existing_leads,
    fetch_kanban_counts,
    fetch_kanban_snapshot,
    fetch_kanban_stage,
    fetch_messages,
    fetch_pinned_messages,
    fetch_reply_target,
    mark_message_deleted,
    MAX_PINNED_MESSAGES,
    pin_message,
    PinLimitReachedError,
    set_message_reaction,
    unpin_message,
    update_message_content,
    list_lead_activity,
    fetch_total_unread_chat_count,
    fetch_unread_wa_message_ids,
    lead_exists,
    mark_chat_read,
    mark_chat_unread,
    mark_lead_no_show,
    list_active_sellers,
    get_customer_service_window,
    rekey_lead_phone,
    remove_tag,
    update_lead,
    update_lead_stage,
)
from services.auth_service import get_current_user, require_admin
from services.lead_merge import LeadMergeError, merge_leads
# Lo que sigue viniendo de Evolution es lo que la Cloud API de Meta no tiene:
# verificar si un número está en WhatsApp, editar y eliminar un mensaje ya
# enviado, y el historial retroactivo. Son capacidades de la sesión de Baileys,
# no endpoints de Meta.
from services.evolution_service import check_whatsapp_numbers
from services.message_media import mediatype_from_content_type as _mediatype_from_content_type
from services.whatsapp_capabilities import (
    EDIT_DELETE_UNSUPPORTED_DETAIL,
    HISTORY_UNSUPPORTED_DETAIL,
    get_whatsapp_capabilities,
)
from services.whatsapp_channel import (
    ChannelError,
    HistoryReader,
    MessageEditor,
    ReactionTarget,
    describe_send_failure,
)
from services.whatsapp_channels import current_channel
from services.whatsapp_identity_service import InvalidWhatsAppIdentityError
from services.phone_utils import (
    PhoneValidationError,
    digits_to_jid,
    effective_country_code,
    normalize_phone,
)
from services.ws_manager import manager
from services.message_outbox import (
    discard_failed_message,
    enqueue_messages,
    enqueue_text_message,
    retry_failed_message,
)
from services import chat_messaging
from services.chat_messaging import (
    ChatMessagingError,
    InvalidTemplateInputError,
    LeadNotFoundError,
    TemplateNotFoundError,
    TemplateNotSendableError,
)
from services.automation_service import (
    pause_lead_executions,
    resume_lead_executions,
    trigger_lead_created,
    notify_automations_scheduled,
)

router = APIRouter(prefix="/api/chats", tags=["chats"])
logger = logging.getLogger(__name__)


# Mapea los nombres de campo de la API (schemas.Chat) a las columnas reales de
# la tabla leads (db.models.Lead) para armar el dict de `update_lead`.
_LEAD_FIELD_TO_COLUMN = {
    "phone": "telefono",
    "secondary_phone": "telefono_secundario",
    "name": "nombre",
    "servicio_interes": "servicio_interes",
    "vendedor_id": "vendedor_id",
    "origen": "origen",
    "notas": "notas",
    "con_especialista": "con_especialista",
    "automatizacion_pausada": "automatizacion_pausada",
    "conversacion_abierta": "conversacion_abierta",
    "razon_perdido": "razon_perdido",
    "fecha_recontacto": "fecha_recontacto",
    "proxima_cita": "proxima_cita",
}


async def _require_existing_lead(chat_id: str) -> None:
    if not await lead_exists(chat_id):
        raise HTTPException(404, "Lead no encontrado")


async def _resolve_reply_to(chat_id: str, message_id: int | None) -> dict | None:
    """Mensaje citado listo para la outbox, o None si no se pidió responder.

    Un mensaje propio que todavía está en la outbox existe en nuestra base
    pero aún no tiene id de WhatsApp, y sin ese id la cita no se puede armar.
    Se rechaza con un mensaje concreto en vez de mandarlo sin cita: quien
    respondió esperaba ver el recuadro, y perderlo en silencio cambia el
    sentido de lo que se envía.
    """
    if message_id is None:
        return None
    target = await fetch_reply_target(chat_id, message_id)
    if target is None:
        raise HTTPException(404, "El mensaje al que querés responder no existe en este chat")
    if not target["wa_message_id"]:
        raise HTTPException(
            409,
            "Ese mensaje todavía no se terminó de enviar a WhatsApp. "
            "Esperá a que salga para poder responderlo.",
        )
    return target


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
    automation_paused: bool = False,
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
            automation_paused,
        )
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="Filtros inválidos")
    except Exception:
        logger.exception("Error inesperado al listar chats")
        raise HTTPException(status_code=500, detail="Error interno al listar chats")


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
    lead = await update_lead_stage(
        chat_id, DbLeadStage(body.stage), "user", user.id, razon_perdido=body.razon_perdido
    )
    if lead is None:
        raise HTTPException(status_code=404, detail="Lead no encontrado")

    await manager.broadcast({"type": "chats_updated", "chat_id": chat_id, "reason": "stage_changed"})
    await notify_automations_scheduled(lead.get("automations_scheduled", 0))
    return lead


async def _verify_whatsapp_number(digits: str) -> tuple[bool | None, str | None]:
    """(existe, jid canónico). existe=None significa que no se pudo verificar
    (Evolution caída o sin configurar): se sigue adelante igual — bloquear el
    alta de leads porque WhatsApp está desconectado dejaría el CRM inusable."""
    try:
        rows = await check_whatsapp_numbers([digits])
    except (ChannelError, httpx.HTTPError):
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
            secondary_phone=body.secondary_phone,
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

    # con_especialista y automatizacion_pausada son NOT NULL: un null
    # explícito se ignora en vez de reventar contra la base.
    if "con_especialista" in values and values["con_especialista"] is None:
        del values["con_especialista"]
    if "automatizacion_pausada" in values and values["automatizacion_pausada"] is None:
        del values["automatizacion_pausada"]
    if "conversacion_abierta" in values and values["conversacion_abierta"] is None:
        del values["conversacion_abierta"]

    # El teléfono ya no es la identidad del lead. Al cambiarlo solo se actualiza
    # su alias externo; el chat_id interno permanece estable.
    new_phone = values.pop("telefono", None)
    if new_phone:
        try:
            digits = normalize_phone(new_phone, await effective_country_code())
        except PhoneValidationError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        new_jid = digits_to_jid(digits)
        exists_wa, canonical_jid = await _verify_whatsapp_number(digits)
        if exists_wa is False:
            raise HTTPException(status_code=422, detail="Ese número no tiene WhatsApp. Revisalo e intentá de nuevo.")
        try:
            rekeyed = await rekey_lead_phone(chat_id, digits, canonical_jid or new_jid, user.id)
        except LeadAlreadyExistsError:
            raise HTTPException(status_code=409, detail="Ya existe un contacto con ese teléfono")
        if rekeyed is None:
            raise HTTPException(status_code=404, detail="Lead no encontrado")

    try:
        lead = await update_lead(chat_id, values, "user", user.id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    if lead is None:
        raise HTTPException(status_code=404, detail="Lead no encontrado")

    # La pausa congela y la reanudación descongela: lo que quedó a medias sigue
    # después por donde iba, con el tiempo que le faltaba (ver
    # pause_lead_executions / resume_lead_executions).
    if values.get("automatizacion_pausada") is True:
        try:
            await pause_lead_executions(chat_id)
        except Exception:
            logger.exception("No se pudieron congelar las automatizaciones programadas al pausar %s", chat_id)
    elif values.get("automatizacion_pausada") is False:
        try:
            await resume_lead_executions(chat_id)
        except Exception:
            logger.exception("No se pudieron reanudar las automatizaciones congeladas de %s", chat_id)

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


@router.post("/{chat_id}/no-show", response_model=Chat)
async def register_no_show(chat_id: str, user: User = Depends(get_current_user)):
    """El vendedor confirma que el cliente no llegó a la cita agendada."""
    lead = await mark_lead_no_show(chat_id, user.id)
    if lead is None:
        raise HTTPException(status_code=404, detail="Lead no encontrado")
    await manager.broadcast({"type": "chats_updated", "chat_id": chat_id, "reason": "lead_updated"})
    return lead


@router.delete("/{chat_id}", status_code=204)
async def delete_chat(chat_id: str, _admin: User = Depends(require_admin)):
    """Borra el lead y todo su historial (mensajes, tareas, notas). No se
    puede deshacer: sin soft-delete, es admin-only a propósito."""
    if not await delete_lead(chat_id):
        raise HTTPException(status_code=404, detail="Lead no encontrado")
    await manager.broadcast({"type": "chats_updated", "chat_id": chat_id, "reason": "lead_deleted"})


@router.post("/{chat_id}/merge", response_model=Chat)
async def merge_chat(chat_id: str, body: LeadMergeRequest, _admin: User = Depends(require_admin)):
    """Fusiona `other_id` (se borra) dentro de `chat_id` (se conserva)."""
    try:
        await merge_leads(body.other_id, chat_id, apply=True)
    except LeadMergeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    lead = await fetch_chat(chat_id)
    if lead is None:
        raise HTTPException(status_code=404, detail="Lead no encontrado")
    await manager.broadcast({"type": "chats_updated", "chat_id": chat_id, "reason": "lead_updated"})
    await manager.broadcast({"type": "chats_updated", "chat_id": body.other_id, "reason": "lead_deleted"})
    return lead


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
    except Exception:
        logger.exception("Error inesperado al obtener mensajes del chat %s", chat_id)
        raise HTTPException(status_code=500, detail="Error interno al obtener mensajes")


@router.get("/history/availability")
async def get_history_availability():
    return {"available": (await get_whatsapp_capabilities())["history_available"]}


def _require_editor() -> MessageEditor:
    editor = current_channel().editor
    if editor is None:
        raise HTTPException(status_code=409, detail=EDIT_DELETE_UNSUPPORTED_DETAIL)
    return editor


async def _require_history() -> HistoryReader:
    history = current_channel().history
    if history is None or not await history.is_available():
        raise HTTPException(status_code=409, detail=HISTORY_UNSUPPORTED_DETAIL)
    return history


@router.get("/{chat_id}/history", response_model=HistoryPage)
async def get_whatsapp_history(
    chat_id: str,
    page: int | None = Query(default=None, ge=1),
    before_ts: datetime | None = None,
):
    """Historial anterior al registro propio, leído de WhatsApp y sin guardar."""
    history = await _require_history()
    try:
        return await history.fetch(chat_id, page, before_ts)
    except ChannelError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except InvalidWhatsAppIdentityError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/{chat_id}/service-window", response_model=CustomerServiceWindow)
async def get_service_window(chat_id: str):
    window = await get_customer_service_window(chat_id)
    if window is None:
        raise HTTPException(404, "Lead no encontrado")
    return window


@router.post("/{chat_id}/messages", response_model=Message)
async def send_message(
    chat_id: str,
    body: SendMessageRequest,
    user: User = Depends(get_current_user),
):
    text = body.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="El mensaje no puede estar vacío")
    await _require_existing_lead(chat_id)
    reply_to = await _resolve_reply_to(chat_id, body.reply_to_message_id)
    message = await enqueue_text_message(chat_id, text, reply_to, actor_user_id=user.id)
    await manager.broadcast({"type": "chats_updated", "chat_id": chat_id, "reason": "outbound_queued"})
    return message


@router.post("/{chat_id}/audio", response_model=Message)
async def send_audio(
    chat_id: str,
    body: SendMediaRequest,
    user: User = Depends(get_current_user),
):
    """Guarda y encola una nota de voz (PTT) sin esperar a Evolution."""
    await _require_existing_lead(chat_id)
    reply_to = await _resolve_reply_to(chat_id, body.reply_to_message_id)
    content_type = body.content_type
    try:
        raw = base64.b64decode(body.data_base64, validate=True)
    except Exception:
        raise HTTPException(status_code=400, detail="El audio no es un archivo válido")
    # Meta Cloud API solo reproduce notas de voz en Ogg/Opus: lo grabado en el
    # navegador viene en webm/opus o mp4/aac, así que se convierte acá antes
    # de guardar. Si ffmpeg falla, sigue el original — mejor eso que no
    # mandar nada (aunque probablemente el destinatario nunca vea el doble
    # check, como con el bug que motivó esto).
    if not content_type.split(";", 1)[0].strip().lower().startswith("audio/ogg"):
        try:
            raw = await asyncio.to_thread(transcode_audio_to_ogg_opus, raw)
            content_type = "audio/ogg"
        except (ValueError, AudioTranscodeError):
            pass
    try:
        media_url = await asyncio.to_thread(save_decoded_media, content_type, raw)
    except ValueError as e:
        status = 413 if "grande" in str(e) else 400
        raise HTTPException(status_code=status, detail=str(e))
    except MediaStorageError as e:
        raise HTTPException(status_code=503, detail=str(e))

    message = (await enqueue_messages(chat_id, [{
        "content": None,
        "media_url": media_url,
        "payload": {"type": "audio", "media_url": media_url},
        "reply_to": reply_to,
    }], actor_user_id=user.id))[0]
    await manager.broadcast({"type": "chats_updated", "chat_id": chat_id, "reason": "outbound_queued"})
    return message


@router.post("/{chat_id}/media", response_model=Message)
async def send_media(
    chat_id: str,
    body: SendMediaRequest,
    user: User = Depends(get_current_user),
):
    """Guarda y encola un adjunto sin esperar a Evolution."""
    await _require_existing_lead(chat_id)
    mediatype = _mediatype_from_content_type(body.content_type)
    if mediatype not in ("image", "video", "audio", "document"):
        raise HTTPException(status_code=400, detail="Tipo de archivo no soportado")
    reply_to = await _resolve_reply_to(chat_id, body.reply_to_message_id)

    try:
        media_url = await asyncio.to_thread(
            save_media_file, body.content_type, body.data_base64, body.filename
        )
    except ValueError as e:
        status = 413 if "grande" in str(e) else 400
        raise HTTPException(status_code=status, detail=str(e))
    except MediaStorageError as e:
        raise HTTPException(status_code=503, detail=str(e))

    # El tipo y el nombre del archivo los deriva enqueue_messages a partir del
    # payload de despacho (message_type = mediatype; el filename de un documento
    # va a la columna payload). El caption (epígrafe) va como content del mensaje
    # y en el payload de despacho para que Evolution lo mande bajo la imagen.
    caption = (body.caption or "").strip() or None
    message = (await enqueue_messages(chat_id, [{
        "content": caption,
        "media_url": media_url,
        "payload": {
            "type": "media",
            "media_url": media_url,
            "mediatype": mediatype,
            "filename": body.filename,
            "caption": caption,
            "album_id": body.album_id,
        },
        "reply_to": reply_to,
    }], actor_user_id=user.id))[0]
    await manager.broadcast({"type": "chats_updated", "chat_id": chat_id, "reason": "outbound_queued"})
    return message


@router.post("/{chat_id}/sticker", response_model=Message)
async def send_sticker(
    chat_id: str,
    body: StickerRequest,
    user: User = Depends(get_current_user),
):
    """Manda una imagen de la librería de medios como sticker."""
    await _require_existing_lead(chat_id)

    asset = await get_media_asset(body.asset_id)
    if asset is None:
        raise HTTPException(404, "El sticker no existe en la librería")
    if not str(asset.get("content_type") or "").startswith("image/"):
        raise HTTPException(400, "Solo se puede mandar una imagen como sticker")

    message = (await enqueue_messages(chat_id, [{
        "media_url": asset["media_url"],
        "payload": {"type": "sticker", "media_url": asset["media_url"]},
    }], actor_user_id=user.id))[0]
    await manager.broadcast({"type": "chats_updated", "chat_id": chat_id, "reason": "outbound_queued"})
    return message


TEMPLATE_ERROR_STATUS: dict[type[ChatMessagingError], int] = {
    TemplateNotFoundError: 404,
    LeadNotFoundError: 404,
    TemplateNotSendableError: 409,
    InvalidTemplateInputError: 400,
}


@router.post("/{chat_id}/templates/{template_id}", response_model=list[Message])
async def send_template(
    chat_id: str,
    template_id: int,
    body: SendTemplateRequest,
    user: User = Depends(get_current_user),
):
    try:
        return await chat_messaging.send_template(chat_id, template_id, body.text, body.parameters, user.id)
    except ChatMessagingError as exc:
        raise HTTPException(TEMPLATE_ERROR_STATUS[type(exc)], str(exc)) from exc


@router.post("/{chat_id}/location", response_model=Message)
async def send_location(
    chat_id: str,
    body: SendLocationRequest,
    user: User = Depends(get_current_user),
):
    await _require_existing_lead(chat_id)
    reply_to = await _resolve_reply_to(chat_id, body.reply_to_message_id)
    # lat/lon van a la columna payload (los deriva enqueue_messages del payload
    # de despacho); el content queda vacío.
    message = (await enqueue_messages(chat_id, [{
        "content": None,
        "payload": {
            "type": "location",
            "latitude": body.latitude,
            "longitude": body.longitude,
        },
        "reply_to": reply_to,
    }], actor_user_id=user.id))[0]
    await manager.broadcast({"type": "chats_updated", "chat_id": chat_id, "reason": "outbound_queued"})
    return message


# Tipos de adjunto que se reenvían con sendMedia, y con qué mediatype. Un
# video-nota (ptv) sale como video normal: WhatsApp no deja crear uno nuevo
# desde la API, y mandarlo como video conserva el contenido.
_FORWARDABLE_MEDIA_TYPES = {
    "image": "image",
    "video": "video",
    "ptv": "video",
    "document": "document",
}


def _forward_item(message: dict) -> dict | None:
    """Convierte un mensaje guardado en un ítem de outbox para otro chat.

    Reenviar es volver a enviar el contenido, no delegar en WhatsApp: el
    archivo ya está en nuestro almacenamiento y el texto en la base, así que
    el destino recibe un mensaje nuevo con el mismo contenido (como el
    "Reenviar" de WhatsApp, que tampoco reenvía el mensaje original).

    Devuelve None si el tipo no se puede volver a enviar y tampoco tiene texto
    con el que sustituirlo — encuestas, contactos, reacciones.
    """
    kind = message["message_type"]
    content = (message["content"] or "").strip() or None
    media_url = message["media_url"]
    payload = message["payload"] or {}

    if media_url and kind in _FORWARDABLE_MEDIA_TYPES:
        mediatype = _FORWARDABLE_MEDIA_TYPES[kind]
        return {
            "content": content,
            "media_url": media_url,
            "payload": {
                "type": "media",
                "media_url": media_url,
                "mediatype": mediatype,
                "filename": payload.get("filename"),
                "caption": content,
            },
            "forwarded": True,
        }
    if media_url and kind == "audio":
        return {
            "content": None,
            "media_url": media_url,
            "payload": {"type": "audio", "media_url": media_url},
            "forwarded": True,
        }
    if media_url and kind == "sticker":
        return {
            "content": None,
            "media_url": media_url,
            "payload": {"type": "sticker", "media_url": media_url},
            "forwarded": True,
        }
    if kind == "location":
        latitude, longitude = payload.get("latitude"), payload.get("longitude")
        if latitude is None or longitude is None:
            return None
        return {
            "content": None,
            "payload": {"type": "location", "latitude": latitude, "longitude": longitude},
            "forwarded": True,
        }
    # Todo lo demás (texto, y también plantillas o interactivos, que del otro
    # lado no se pueden reconstruir) viaja como texto plano mientras haya algo
    # que decir. Un adjunto cuyo archivo ya no está queda igual: se reenvía su
    # epígrafe, que es lo único que sobrevive.
    if content:
        return {
            "content": content,
            "payload": {"type": "text", "text": content},
            "forwarded": True,
        }
    return None


@router.post("/{chat_id}/messages/forward", response_model=ForwardMessagesResponse)
async def forward_messages(
    chat_id: str,
    body: ForwardMessagesRequest,
    user: User = Depends(get_current_user),
):
    """Reenvía uno o varios mensajes de este chat a otros leads.

    Cada destino recibe los mensajes en el orden en que están en la
    conversación de origen, encolados por la outbox como cualquier otro envío
    (con reintentos y sin bloquear la respuesta).
    """
    await _require_existing_lead(chat_id)
    messages = await fetch_messages_to_forward(chat_id, body.message_ids)
    if not messages:
        raise HTTPException(404, "No se encontraron los mensajes a reenviar")

    items = [item for item in (_forward_item(message) for message in messages) if item]
    skipped = len(messages) - len(items)
    if not items:
        raise HTTPException(409, "Ninguno de los mensajes seleccionados se puede reenviar")

    # Se validan todos los destinos de una vez: reenviar a un lead borrado no
    # debería tumbar el reenvío a los demás.
    targets = list(dict.fromkeys(body.target_chat_ids))
    existing = await filter_existing_leads(targets)
    targets = [target for target in targets if target in existing]
    if not targets:
        raise HTTPException(404, "Ninguno de los chats destino existe")

    for target in targets:
        await enqueue_messages(target, items, actor_user_id=user.id)
        await manager.broadcast({
            "type": "chats_updated", "chat_id": target, "reason": "outbound_queued",
        })

    return ForwardMessagesResponse(
        forwarded_chats=len(targets),
        forwarded_messages=len(items) * len(targets),
        skipped_messages=skipped,
    )


@router.post("/{chat_id}/messages/{message_id}/retry", response_model=Message)
async def retry_message(chat_id: str, message_id: int):
    message = await retry_failed_message(chat_id, message_id)
    if message is None:
        raise HTTPException(409, "El mensaje no está fallido o ya fue reintentado")
    await manager.broadcast({"type": "chats_updated", "chat_id": chat_id, "reason": "outbound_queued"})
    return message


@router.post("/{chat_id}/messages/{message_id}/discard", response_model=Message)
async def discard_message(chat_id: str, message_id: int):
    message = await discard_failed_message(chat_id, message_id)
    if message is None:
        raise HTTPException(409, "El mensaje no está fallido o ya fue reintentado")
    return message


@router.post("/{chat_id}/messages/{message_id}/reaction", response_model=Message)
async def react_to_message(chat_id: str, message_id: int, body: ReactionRequest):
    """Reacciona (o quita la reacción) del vendedor sobre un mensaje del chat.

    Manda primero a WhatsApp y recién si eso funciona persiste el badge: una
    reacción que solo se viera de nuestro lado engañaría al vendedor haciéndole
    creer que el cliente la vio."""
    target = await fetch_reply_target(chat_id, message_id)
    if target is None:
        raise HTTPException(404, "El mensaje no existe en este chat")
    if not target["wa_message_id"]:
        # Un mensaje del vendedor todavía en la outbox no tiene id de WhatsApp:
        # no se le puede reaccionar hasta que se confirme el envío.
        raise HTTPException(409, "El mensaje todavía no está confirmado en WhatsApp")

    reaction_target = ReactionTarget(
        chat_id=chat_id,
        provider_message_id=target["wa_message_id"],
        from_me=target["sender"] == "vendedor",
    )
    try:
        await current_channel().actions.react(reaction_target, body.emoji)
    except (ChannelError, httpx.HTTPError) as exc:
        logger.warning("No se pudo enviar la reacción a WhatsApp para %s: %s", chat_id, exc)
        raise HTTPException(502, describe_send_failure(exc, "enviar la reacción a WhatsApp"))

    message = await set_message_reaction(chat_id, target["wa_message_id"], body.emoji, from_me=True)
    await manager.broadcast({"type": "chats_updated", "chat_id": chat_id, "reason": "reaction"})
    return message


# WhatsApp deja reescribir un mensaje propio de texto solo dentro de esta
# ventana. Se comprueba acá para poder explicarlo: pasado el límite Evolution
# acepta el pedido pero WhatsApp lo descarta en silencio, y el vendedor se
# quedaría creyendo que corrigió algo que el cliente sigue viendo como estaba.
EDIT_MESSAGE_WINDOW = timedelta(minutes=15)


def _editable_or_deletable_target(target: dict | None, action: str) -> dict:
    """Comprobaciones que comparten editar y eliminar.

    WhatsApp solo permite las dos cosas sobre mensajes propios y ya
    confirmados; de un mensaje del cliente no se puede tocar nada (el "eliminar
    para todos" ajeno no existe fuera de los grupos, y ahí solo para admins).
    """
    if target is None:
        raise HTTPException(404, "El mensaje no existe en este chat")
    if target["deleted_at"] is not None:
        raise HTTPException(409, "El mensaje ya fue eliminado")
    if target["sender"] != "vendedor":
        raise HTTPException(409, f"WhatsApp solo permite {action} los mensajes que enviaste vos")
    if not target["wa_message_id"]:
        # Un mensaje del vendedor todavía en la outbox no tiene id de WhatsApp:
        # no existe del otro lado como para editarlo o borrarlo.
        raise HTTPException(409, "El mensaje todavía no está confirmado en WhatsApp")
    return target


@router.patch("/{chat_id}/messages/{message_id}", response_model=Message)
async def edit_message(chat_id: str, message_id: int, body: EditMessageRequest):
    """Reescribe el texto de un mensaje ya enviado, como el "Editar" de WhatsApp.

    Igual que las reacciones: primero WhatsApp y recién después la base. Un
    texto corregido solo de nuestro lado sería peor que no corregirlo — el
    vendedor daría por hecho que el cliente ve la versión nueva.
    """
    editor = _require_editor()
    target = _editable_or_deletable_target(
        await fetch_reply_target(chat_id, message_id), "editar"
    )
    if target["message_type"] not in (None, "text"):
        raise HTTPException(409, "WhatsApp solo permite editar mensajes de texto")
    sent_at = target["sent_at"]
    if sent_at is not None and datetime.now(timezone.utc) - sent_at > EDIT_MESSAGE_WINDOW:
        raise HTTPException(
            409,
            "WhatsApp solo permite editar un mensaje dentro de los 15 minutos posteriores al envío",
        )

    text = body.text.strip()
    if not text:
        raise HTTPException(400, "El texto del mensaje no puede quedar vacío")

    try:
        await editor.edit(chat_id, target["wa_message_id"], text)
    except (ChannelError, httpx.HTTPError) as exc:
        logger.warning("No se pudo editar el mensaje en WhatsApp para %s: %s", chat_id, exc)
        raise HTTPException(502, describe_send_failure(exc, "editar el mensaje en WhatsApp"))

    message = await update_message_content(chat_id, target["wa_message_id"], text)
    if message is None:
        raise HTTPException(404, "El mensaje no existe en este chat")
    await manager.broadcast({"type": "chats_updated", "chat_id": chat_id, "reason": "message_edited"})
    return message


@router.delete("/{chat_id}/messages/{message_id}", response_model=Message)
async def delete_message(chat_id: str, message_id: int):
    """Elimina para todos un mensaje ya enviado.

    No borra la fila: la marca como eliminada y deja de servir su contenido
    (ver mark_message_deleted). El CRM conserva que hubo un mensaje ahí —el
    hilo muestra la lápida, como WhatsApp— sin exponer lo que decía.
    """
    editor = _require_editor()
    target = _editable_or_deletable_target(
        await fetch_reply_target(chat_id, message_id), "eliminar"
    )

    try:
        await editor.delete(chat_id, target["wa_message_id"])
    except (ChannelError, httpx.HTTPError) as exc:
        logger.warning("No se pudo eliminar el mensaje en WhatsApp para %s: %s", chat_id, exc)
        raise HTTPException(502, describe_send_failure(exc, "eliminar el mensaje en WhatsApp"))

    message = await mark_message_deleted(chat_id, target["wa_message_id"])
    if message is None:
        raise HTTPException(404, "El mensaje no existe en este chat")
    await manager.broadcast({"type": "chats_updated", "chat_id": chat_id, "reason": "message_deleted"})
    return message


@router.get("/{chat_id}/pinned-messages", response_model=PinnedMessagesResponse)
async def get_pinned_messages(chat_id: str):
    return {"items": await fetch_pinned_messages(chat_id)}


@router.post("/{chat_id}/messages/{message_id}/pin", response_model=Message)
async def pin_chat_message(chat_id: str, message_id: int, user: User = Depends(get_current_user)):
    """Fija un mensaje, como el "Fijar" de WhatsApp — pero solo dentro del CRM:
    ni Evolution API ni Baileys exponen forma de fijar un mensaje del lado de
    quien envía, así que esto no se refleja en el WhatsApp del cliente."""
    try:
        message = await pin_message(chat_id, message_id, user.id)
    except PinLimitReachedError:
        raise HTTPException(
            409, f"Ya hay {MAX_PINNED_MESSAGES} mensajes fijados en este chat. Desfijá uno primero."
        )
    if message is None:
        raise HTTPException(404, "El mensaje no existe en este chat")
    await manager.broadcast({"type": "chats_updated", "chat_id": chat_id, "reason": "message_pinned"})
    return message


@router.post("/{chat_id}/messages/{message_id}/unpin", response_model=Message)
async def unpin_chat_message(chat_id: str, message_id: int):
    message = await unpin_message(chat_id, message_id)
    if message is None:
        raise HTTPException(404, "El mensaje no existe en este chat")
    await manager.broadcast({"type": "chats_updated", "chat_id": chat_id, "reason": "message_pinned"})
    return message


@router.post("/{chat_id}/read")
async def read_chat(chat_id: str):
    """Marca el chat como visto por el vendedor — resetea unread_count a 0 y
    le avisa a WhatsApp (tiques azules del lado del cliente) de los mensajes
    que todavía no se habían marcado como leídos."""
    wa_message_ids = await fetch_unread_wa_message_ids(chat_id)
    if wa_message_ids:
        try:
            await current_channel().actions.mark_read(chat_id, wa_message_ids)
        except (ChannelError, httpx.HTTPError, InvalidWhatsAppIdentityError) as exc:
            # Best-effort: si Meta falla (no configurada, mensaje ya no existe
            # del lado de WhatsApp, etc.) igual se marca como visto de nuestro
            # lado — no tiene sentido bloquear el badge interno por un problema
            # ajeno a nuestra base.
            logger.warning(
                "No se pudieron marcar %d mensajes como leídos en Meta para %s: %s",
                len(wa_message_ids),
                chat_id,
                exc,
            )

    await mark_chat_read(chat_id)
    await manager.broadcast({"type": "chats_updated", "chat_id": chat_id, "reason": "read"})
    return {"status": "ok"}


@router.post("/{chat_id}/unread")
async def unread_chat(chat_id: str):
    """Marca el chat como pendiente dentro del CRM. No revierte los recibos
    de lectura ya enviados a WhatsApp."""
    if not await mark_chat_unread(chat_id):
        raise HTTPException(404, "El chat no tiene mensajes del cliente para marcar")
    await manager.broadcast({"type": "chats_updated", "chat_id": chat_id, "reason": "unread"})
    return {"status": "ok"}

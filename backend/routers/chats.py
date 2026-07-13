import logging
from datetime import datetime

import httpx
from fastapi import APIRouter, HTTPException, Query
from models.schemas import (
    Chat,
    ChatPage,
    KanbanPage,
    LeadCreate,
    LeadStage,
    LeadStageUpdate,
    LeadUpdate,
    Message,
    MessagePage,
    SendLocationRequest,
    SendMediaRequest,
    SendMessageRequest,
)
from routers.media import save_media_file
from services.db_service import (
    CHATS_PAGE_SIZE,
    KANBAN_PAGE_SIZE,
    MESSAGES_PAGE_SIZE,
    LeadAlreadyExistsError,
    create_lead,
    fetch_chats,
    fetch_kanban_counts,
    fetch_kanban_stage,
    fetch_messages,
    fetch_total_unread_chat_count,
    fetch_unread_wa_message_ids,
    insert_message,
    mark_chat_read,
    update_lead,
    update_lead_stage,
)
from db.models import LeadStage as DbLeadStage
from services.evolution_service import (
    EvolutionApiError,
    mark_messages_as_read,
    send_whatsapp_audio,
    send_whatsapp_location,
    send_whatsapp_media,
    send_whatsapp_text,
)
from services.ws_manager import manager

router = APIRouter(prefix="/api/chats", tags=["chats"])
logger = logging.getLogger(__name__)

# Mapea los nombres de campo de la API (schemas.Chat) a las columnas reales de
# la tabla leads (db.models.Lead) para armar el dict de `update_lead`.
_LEAD_FIELD_TO_COLUMN = {
    "phone": "telefono",
    "name": "nombre",
    "servicio_interes": "servicio_interes",
    "vendedor": "vendedor",
    "origen": "origen",
    "notas": "notas",
}


def _mediatype_from_content_type(content_type: str) -> str:
    if content_type.startswith("image/"):
        return "image"
    if content_type.startswith("video/"):
        return "video"
    if content_type.startswith("audio/"):
        return "audio"
    return "document"


def _wa_message_id(evolution_response: dict) -> str | None:
    """El id de WhatsApp (key.id) que Evolution API devuelve al mandar un
    mensaje — se guarda para poder matchear después los eventos de estado
    (entregado/leído). Se accede con .get anidados porque el shape exacto
    de la respuesta no está documentado de forma confiable."""
    key = evolution_response.get("key")
    return key.get("id") if isinstance(key, dict) else None


@router.get("", response_model=ChatPage)
async def get_chats(
    search: str | None = None,
    cursor_ts: str | None = None,
    cursor_id: str | None = None,
    limit: int = CHATS_PAGE_SIZE,
    unread_only: bool = False,
):
    try:
        return await fetch_chats(search, cursor_ts, cursor_id, limit, unread_only)
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
async def move_chat_stage(chat_id: str, body: LeadStageUpdate):
    lead = await update_lead_stage(chat_id, DbLeadStage(body.stage))
    if lead is None:
        raise HTTPException(status_code=404, detail="Lead no encontrado")

    await manager.broadcast({"type": "chats_updated"})
    return lead


@router.post("", response_model=Chat, status_code=201)
async def create_chat(body: LeadCreate):
    phone = body.phone.strip()
    name = body.name.strip()
    if not phone:
        raise HTTPException(status_code=400, detail="El teléfono es obligatorio")
    if not name:
        raise HTTPException(status_code=400, detail="El nombre es obligatorio")

    try:
        lead = await create_lead(
            phone=phone,
            name=name,
            servicio_interes=body.servicio_interes,
            vendedor=body.vendedor,
            origen=body.origen,
            notas=body.notas,
        )
    except LeadAlreadyExistsError:
        raise HTTPException(status_code=409, detail="Ya existe un contacto con ese teléfono")

    await manager.broadcast({"type": "chats_updated"})
    return lead


@router.patch("/{chat_id}", response_model=Chat)
async def update_chat(chat_id: str, body: LeadUpdate):
    values = {
        _LEAD_FIELD_TO_COLUMN[k]: v for k, v in body.model_dump(exclude_unset=True).items()
    }
    lead = await update_lead(chat_id, values)
    if lead is None:
        raise HTTPException(status_code=404, detail="Lead no encontrado")

    await manager.broadcast({"type": "chats_updated"})
    return lead


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


@router.post("/{chat_id}/messages", response_model=Message)
async def send_message(chat_id: str, body: SendMessageRequest):
    text = body.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="El mensaje no puede estar vacío")

    try:
        evolution_response = await send_whatsapp_text(chat_id, text)
    except EvolutionApiError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Error llamando a Evolution API: {e}")

    message = await insert_message(
        chat_id, sender="vendedor", content=text, wa_message_id=_wa_message_id(evolution_response)
    )
    await manager.broadcast({"type": "chats_updated"})
    return message


@router.post("/{chat_id}/audio", response_model=Message)
async def send_audio(chat_id: str, body: SendMediaRequest):
    """Nota de voz grabada en vivo (PTT) — endpoint sendWhatsAppAudio."""
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
    )
    await manager.broadcast({"type": "chats_updated"})
    return message


@router.post("/{chat_id}/media", response_model=Message)
async def send_media(chat_id: str, body: SendMediaRequest):
    """Adjuntar un archivo ya existente — imagen, video, audio (como archivo,
    no nota de voz) o documento — vía sendMedia."""
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
    )
    await manager.broadcast({"type": "chats_updated"})
    return message


@router.post("/{chat_id}/location", response_model=Message)
async def send_location(chat_id: str, body: SendLocationRequest):
    try:
        evolution_response = await send_whatsapp_location(chat_id, body.latitude, body.longitude)
    except EvolutionApiError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Error llamando a Evolution API: {e}")

    content = f"<location>{body.latitude},{body.longitude}</location>"
    message = await insert_message(
        chat_id, sender="vendedor", content=content, wa_message_id=_wa_message_id(evolution_response)
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

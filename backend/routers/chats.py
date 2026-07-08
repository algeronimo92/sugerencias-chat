import httpx
from fastapi import APIRouter, HTTPException
from models.schemas import Chat, ChatPage, LeadCreate, LeadUpdate, Message, SendLocationRequest, SendMediaRequest, SendMessageRequest
from routers.media import save_media_file
from services.db_service import (
    CHATS_PAGE_SIZE,
    LeadAlreadyExistsError,
    create_lead,
    fetch_chats,
    fetch_messages,
    insert_message,
    update_lead,
)
from services.evolution_service import (
    EvolutionApiError,
    send_whatsapp_audio,
    send_whatsapp_location,
    send_whatsapp_media,
    send_whatsapp_text,
)
from services.ws_manager import manager

router = APIRouter(prefix="/api/chats", tags=["chats"])

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


@router.get("", response_model=ChatPage)
async def get_chats(
    search: str | None = None,
    cursor_ts: str | None = None,
    cursor_id: str | None = None,
    limit: int = CHATS_PAGE_SIZE,
):
    try:
        return await fetch_chats(search, cursor_ts, cursor_id, limit)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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


@router.get("/{chat_id}/messages", response_model=list[Message])
async def get_messages(chat_id: str):
    try:
        rows = await fetch_messages(chat_id)
        return rows
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{chat_id}/messages", response_model=Message)
async def send_message(chat_id: str, body: SendMessageRequest):
    text = body.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="El mensaje no puede estar vacío")

    try:
        await send_whatsapp_text(chat_id, text)
    except EvolutionApiError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Error llamando a Evolution API: {e}")

    message = await insert_message(chat_id, sender="vendedor", content=text)
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
        await send_whatsapp_audio(chat_id, body.data_base64)
    except EvolutionApiError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Error llamando a Evolution API: {e}")

    message = await insert_message(chat_id, sender="vendedor", content="<audio></audio>", media_url=media_url)
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
        await send_whatsapp_media(chat_id, body.data_base64, mediatype, filename=body.filename)
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
    message = await insert_message(chat_id, sender="vendedor", content=content, media_url=media_url)
    await manager.broadcast({"type": "chats_updated"})
    return message


@router.post("/{chat_id}/location", response_model=Message)
async def send_location(chat_id: str, body: SendLocationRequest):
    try:
        await send_whatsapp_location(chat_id, body.latitude, body.longitude)
    except EvolutionApiError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Error llamando a Evolution API: {e}")

    content = f"<location>{body.latitude},{body.longitude}</location>"
    message = await insert_message(chat_id, sender="vendedor", content=content)
    await manager.broadcast({"type": "chats_updated"})
    return message

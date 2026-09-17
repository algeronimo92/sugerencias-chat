import asyncio
import base64

from fastapi import Depends, HTTPException
from db.models import User
from models.schemas import (
    ForwardMessagesRequest,
    ForwardMessagesResponse,
    Message,
    StickerRequest,
    SendLocationRequest,
    SendMediaRequest,
    SendMessageRequest,
    SendTemplateRequest,
)
from services.media_upload import save_decoded_media, save_media_file
from services.media_storage import (
    AudioTranscodeError,
    MediaStorageError,
    transcode_audio_to_ogg_opus,
)
from services.media_library_service import get_media_asset
from services.db_service import fetch_messages_to_forward, filter_existing_leads, fetch_reply_target
from services.auth_service import get_current_user
from services.message_media import mediatype_from_content_type as _mediatype_from_content_type
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
    forward_item,
)
from routers.chats.common import _require_existing_lead, _require_open_service_window, chats_router


router = chats_router()


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
    await _require_open_service_window(chat_id)
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
    await _require_open_service_window(chat_id)
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
    await _require_open_service_window(chat_id)
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
    await _require_open_service_window(chat_id)

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
    await _require_open_service_window(chat_id)
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
    # La ventana de 24 h no se comprueba acá: el envío no va a este chat sino a
    # los destinos, que tienen cada uno la suya. Reenviar desde una
    # conversación cerrada a una abierta es válido.
    await _require_existing_lead(chat_id)
    messages = await fetch_messages_to_forward(chat_id, body.message_ids)
    if not messages:
        raise HTTPException(404, "No se encontraron los mensajes a reenviar")

    items = [item for item in (forward_item(message) for message in messages) if item]
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

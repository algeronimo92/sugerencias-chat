import asyncio
import base64

from fastapi import Depends, HTTPException
from app.db.models.auth import User
from app.modules.catalogs.schemas import SendTemplateRequest
from app.modules.conversations.schemas import ForwardMessagesRequest, ForwardMessagesResponse, Message, SendInteractiveRequest, StickerRequest, SendLocationRequest, SendContactsRequest, SendMediaRequest, SendMessageRequest
from app.modules.media.ports.media_upload import (save_decoded_media, save_media_file)
from app.integrations.storage.media_storage import (AudioTranscodeError, MediaStorageError, transcode_audio_to_ogg_opus)
from app.modules.media.ports.media_library_service import (get_media_asset)
from app.core.phone_utils import PhoneValidationError, normalize_phone
from app.modules.platform.public import effective_country_code
from app.modules.conversations.message_history import fetch_messages_to_forward, filter_existing_leads, fetch_reply_target
from app.modules.auth.public import get_current_user
from app.modules.conversations.message_media import mediatype_from_content_type as _mediatype_from_content_type
from app.realtime.ws_manager import manager
from app.modules.conversations.message_outbox import (
    discard_failed_message,
    enqueue_messages,
    retry_failed_message,
)
from app.integrations.meta.outbound import (
    OutboundRejected,
    contacts_item,
    interactive_item,
    location_item,
    media_item,
    sticker_item,
    text_item,
)
from app.modules.conversations import chat_messaging
from app.modules.conversations.chat_messaging import (
    ChatMessagingError,
    InvalidTemplateInputError,
    LeadNotFoundError,
    TemplateNotFoundError,
    TemplateNotSendableError,
    forward_item,
)
from app.modules.conversations.common import _require_existing_lead, _require_open_service_window, chats_router


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


async def _enqueue_one(chat_id: str, item: dict, user: User, reply_to: dict | None = None) -> dict:
    """Encola un envío del vendedor y avisa a los paneles.

    Una salida que Meta no acepta (tipo, forma o capacidad de la cuenta) se
    rechaza con 422 antes de crear nada en el outbox.
    """
    try:
        message = (await enqueue_messages(
            chat_id, [{**item, "reply_to": reply_to}], actor_user_id=user.id,
        ))[0]
    except OutboundRejected as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    await manager.broadcast({"type": "chats_updated", "chat_id": chat_id, "reason": "outbound_queued"})
    return message


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
    return await _enqueue_one(chat_id, text_item(text), user, reply_to)


@router.post("/{chat_id}/audio", response_model=Message)
async def send_audio(
    chat_id: str,
    body: SendMediaRequest,
    user: User = Depends(get_current_user),
):
    """Guarda y encola una nota de voz sin esperar a Meta."""
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

    return await _enqueue_one(
        chat_id, media_item(media_url, "audio", content_type=content_type), user, reply_to,
    )


@router.post("/{chat_id}/media", response_model=Message)
async def send_media(
    chat_id: str,
    body: SendMediaRequest,
    user: User = Depends(get_current_user),
):
    """Guarda y encola un adjunto sin esperar a Meta."""
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

    # El caption (epígrafe) va dentro del objeto de Meta y como content del
    # mensaje, para la lista de chats y la búsqueda.
    caption = (body.caption or "").strip() or None
    return await _enqueue_one(
        chat_id,
        media_item(
            media_url,
            mediatype,
            filename=body.filename,
            caption=caption,
            content_type=body.content_type,
            album_id=body.album_id,
        ),
        user,
        reply_to,
    )


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

    return await _enqueue_one(chat_id, sticker_item(asset["media_url"]), user)


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
    except OutboundRejected as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/{chat_id}/location", response_model=Message)
async def send_location(
    chat_id: str,
    body: SendLocationRequest,
    user: User = Depends(get_current_user),
):
    await _require_existing_lead(chat_id)
    await _require_open_service_window(chat_id)
    reply_to = await _resolve_reply_to(chat_id, body.reply_to_message_id)
    return await _enqueue_one(chat_id, location_item(body.latitude, body.longitude), user, reply_to)


@router.post("/{chat_id}/contacts", response_model=Message)
async def send_contacts(
    chat_id: str,
    body: SendContactsRequest,
    user: User = Depends(get_current_user),
):
    """Comparte uno o varios leads como una sola lista de contactos nativa."""
    await _require_existing_lead(chat_id)
    await _require_open_service_window(chat_id)
    reply_to = await _resolve_reply_to(chat_id, body.reply_to_message_id)
    country_code = await effective_country_code()
    contacts = []
    try:
        for item in body.contacts:
            full_name = item.full_name.strip()
            if not full_name:
                raise HTTPException(400, "Cada contacto debe tener un nombre")
            contacts.append({"full_name": full_name, "phone": normalize_phone(item.phone_number, country_code)})
    except PhoneValidationError as exc:
        raise HTTPException(400, str(exc)) from exc
    return await _enqueue_one(chat_id, contacts_item(contacts), user, reply_to)


@router.post("/{chat_id}/interactive", response_model=Message)
async def send_interactive(
    chat_id: str,
    body: SendInteractiveRequest,
    user: User = Depends(get_current_user),
):
    """Envía un objeto ``interactive`` de Meta tal cual (botones, lista,
    productos, catálogo, Flow o pedido de permiso de llamada).

    El subtipo tiene que estar en la allowlist de salida y, si depende de la
    cuenta (catálogo, Flow publicado, llamadas), la cuenta tiene que tenerlo.
    """
    await _require_existing_lead(chat_id)
    await _require_open_service_window(chat_id)
    reply_to = await _resolve_reply_to(chat_id, body.reply_to_message_id)
    return await _enqueue_one(chat_id, interactive_item(body.interactive), user, reply_to)


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
        try:
            await enqueue_messages(target, items, actor_user_id=user.id)
        except OutboundRejected as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
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

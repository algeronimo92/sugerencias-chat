import asyncio
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from services.media_storage import image_to_sticker_webp, read_media_bytes, stat_media
from services.message_media import media_message_fields
from services.whatsapp_channel import MessageSender, SendReceipt
from services.whatsapp_rules import buttons_are_reply_only, buttons_text_fallback, resolve_interactive_footer

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class OutboundDelivery:
    receipt: SendReceipt
    delivered_content: str | None = None


@dataclass(frozen=True)
class OutboundKind:
    message_fields: Callable[[dict], tuple[str, dict | None]]
    send: Callable[[MessageSender, str, dict], Awaitable[OutboundDelivery]]


async def _stored_media(media_url: str) -> tuple[bytes, str, str]:
    info = await asyncio.to_thread(stat_media, media_url)
    content = await asyncio.to_thread(read_media_bytes, media_url)
    return content, info.content_type, media_url.rsplit("/", 1)[-1]


async def _send_text(sender: MessageSender, chat_id: str, payload: dict) -> OutboundDelivery:
    return OutboundDelivery(await sender.send_text(chat_id, payload["text"], quoted=payload.get("quoted")))


async def _send_audio(sender: MessageSender, chat_id: str, payload: dict) -> OutboundDelivery:
    content, content_type, filename = await _stored_media(payload["media_url"])
    return OutboundDelivery(await sender.send_audio(
        chat_id, content, content_type, filename, quoted=payload.get("quoted"),
    ))


async def _send_media(sender: MessageSender, chat_id: str, payload: dict) -> OutboundDelivery:
    content, content_type, _filename = await _stored_media(payload["media_url"])
    return OutboundDelivery(await sender.send_media(
        chat_id, content, content_type, payload["mediatype"],
        filename=payload.get("filename"), caption=payload.get("caption"), quoted=payload.get("quoted"),
    ))


async def _send_sticker(sender: MessageSender, chat_id: str, payload: dict) -> OutboundDelivery:
    data = await asyncio.to_thread(read_media_bytes, payload["media_url"])
    sticker_bytes = await asyncio.to_thread(image_to_sticker_webp, data)
    return OutboundDelivery(await sender.send_sticker(chat_id, sticker_bytes))


async def _send_location(sender: MessageSender, chat_id: str, payload: dict) -> OutboundDelivery:
    return OutboundDelivery(await sender.send_location(
        chat_id, payload["latitude"], payload["longitude"], quoted=payload.get("quoted"),
    ))


async def _send_official_template(sender: MessageSender, chat_id: str, payload: dict) -> OutboundDelivery:
    return OutboundDelivery(await sender.send_template(
        chat_id, payload["name"], payload["language"], payload.get("components", []),
    ))


async def _send_buttons(
    sender: MessageSender, chat_id: str, description: str, config: dict, footer: str,
) -> OutboundDelivery:
    buttons = config["buttons"]
    if buttons_are_reply_only(buttons):
        return OutboundDelivery(await sender.send_buttons(chat_id, config["title"], description, footer, buttons))
    # La Graph API de Meta solo acepta botones "reply" en un mensaje
    # interactivo suelto (fuera de una plantilla oficial): un botón de
    # URL, llamada o copiar código siempre rechaza con
    # "interactive.action.buttons.N.reply is required" (código 100),
    # confirmado con tráfico real -- no es un caso límite, es la regla.
    fallback = buttons_text_fallback(config["title"], description, footer, buttons)
    logger.info(
        "Botones con tipo no-reply; Meta los rechaza en un mensaje interactivo "
        "suelto, se manda como texto numerado"
    )
    return OutboundDelivery(await sender.send_text(chat_id, fallback), fallback)


async def _send_list(
    sender: MessageSender, chat_id: str, description: str, config: dict, footer: str,
) -> OutboundDelivery:
    return OutboundDelivery(await sender.send_list(
        chat_id, config["title"], description, footer, config["buttonText"], config["sections"],
    ))


INTERACTIVE_SENDERS: dict[str, Callable[[MessageSender, str, str, dict, str], Awaitable[OutboundDelivery]]] = {
    "buttons": _send_buttons,
    "list": _send_list,
}


async def _send_interactive(sender: MessageSender, chat_id: str, payload: dict) -> OutboundDelivery:
    interactive_type = payload["interactive_type"]
    send = INTERACTIVE_SENDERS.get(interactive_type)
    if send is None:
        raise ValueError(f"Tipo interactivo no soportado: {interactive_type}")
    config = payload["config"]
    footer = await resolve_interactive_footer(interactive_type, config)
    return await send(sender, chat_id, payload["description"], config, footer)


def _interactive_fields(payload: dict) -> tuple[str, dict | None]:
    # El frontend arma los botones/lista de la burbuja a partir de esto
    # (ver parseOutboundInteractive en frontend/src/utils/message.ts):
    # sin config/description solo puede mostrar texto plano.
    return "interactive", {
        "type": "interactive",
        "interactive_type": payload.get("interactive_type"),
        "config": payload.get("config"),
        "description": payload.get("description"),
    }


OUTBOUND_KINDS: dict[str, OutboundKind] = {
    "text": OutboundKind(lambda _payload: ("text", None), _send_text),
    "audio": OutboundKind(lambda _payload: ("audio", None), _send_audio),
    "media": OutboundKind(
        lambda payload: media_message_fields(payload["mediatype"], payload.get("filename"), payload.get("album_id")),
        _send_media,
    ),
    "sticker": OutboundKind(lambda _payload: ("sticker", None), _send_sticker),
    "location": OutboundKind(
        lambda payload: ("location", {"latitude": payload["latitude"], "longitude": payload["longitude"]}),
        _send_location,
    ),
    "official_template": OutboundKind(
        lambda payload: ("template", {"name": payload.get("name"), "language": payload.get("language")}),
        _send_official_template,
    ),
    "interactive": OutboundKind(_interactive_fields, _send_interactive),
}


def _require_kind(payload: dict) -> OutboundKind:
    kind = OUTBOUND_KINDS.get(payload.get("type"))
    if kind is None:
        raise ValueError(f"Tipo de outbox no soportado: {payload.get('type')}")
    return kind


def outbound_message_fields(payload: dict) -> tuple[str, dict | None]:
    """Falla al encolar y no al enviar.

    Antes devolvía ("unsupported", None) para un tipo que el registro no
    conoce, así que el mensaje se persistía igual y recién reventaba en el
    worker: una fila muerta en la outbox y una burbuja fallida en el chat por
    lo que siempre es un error de programación.
    """
    return _require_kind(payload).message_fields(payload)


async def send_outbound(sender: MessageSender, chat_id: str, payload: dict) -> OutboundDelivery:
    return await _require_kind(payload).send(sender, chat_id, payload)

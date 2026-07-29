"""Historial de un chat leído directamente de WhatsApp (Evolution API).

Estos mensajes NO se guardan: son anteriores al registro propio y se muestran
al vuelo, solo de lectura. Por eso el shape de salida es parecido al de
`wsp_messages` pero sin `id` local, sin estado de entrega y sin multimedia
descargada — de un adjunto viejo se muestra el tipo y el epígrafe, no el
archivo.

La forma de la respuesta de `chat/findMessages` cambió entre versiones de
Evolution, así que todo lo que se lee de ahí se trata como no confiable.
"""

import logging
from datetime import datetime, timezone
from typing import Any

from services.db_service import count_wa_messages, existing_wa_message_ids
from services.evolution_service import HISTORY_PAGE_SIZE, find_chat_messages

logger = logging.getLogger(__name__)

# Tope de llamadas a Evolution por request. Cuando el tramo pedido cae dentro
# de lo que ya está en la base, cada página se descarta entera y hay que
# seguir buscando; sin este techo un chat largo dejaría el request colgado.
MAX_EVOLUTION_CALLS = 10

# Cuántas veces se puede corregir la página inicial estimada antes de aceptar
# lo que haya (ver `_estimate_start_page`).
MAX_PAGE_CORRECTIONS = 3

# Envoltorios que WhatsApp pone alrededor del mensaje real.
_WRAPPERS = (
    "ephemeralMessage",
    "viewOnceMessage",
    "viewOnceMessageV2",
    "viewOnceMessageV2Extension",
    "documentWithCaptionMessage",
)

# Tipos sin representación en el hilo: reacciones, borrados, claves de cifrado.
_SKIPPED_TYPES = {
    "reactionMessage",
    "protocolMessage",
    "senderKeyDistributionMessage",
    "pollUpdateMessage",
    "messageContextInfo",
}


def _extract_records(payload: Any) -> tuple[list[dict], int | None, int | None]:
    """Saca la lista de mensajes de la respuesta, sea cual sea su forma.

    Evolution v2 devuelve `{"messages": {"total", "pages", "currentPage",
    "records": [...]}}`; versiones anteriores devolvían la lista pelada o
    bajo `messages`. Ante cualquier otra cosa se devuelve vacío en vez de
    reventar: el hilo muestra "no hay historial" y sigue funcionando.
    """
    if isinstance(payload, list):
        return [r for r in payload if isinstance(r, dict)], None, None

    if not isinstance(payload, dict):
        return [], None, None

    messages = payload.get("messages", payload)

    if isinstance(messages, list):
        return [r for r in messages if isinstance(r, dict)], None, None

    if isinstance(messages, dict):
        records = messages.get("records")
        if isinstance(records, list):
            pages = messages.get("pages")
            current = messages.get("currentPage")
            return (
                [r for r in records if isinstance(r, dict)],
                pages if isinstance(pages, int) else None,
                current if isinstance(current, int) else None,
            )

    return [], None, None


def _unwrap_message(message: dict) -> dict:
    """Desanida los envoltorios de mensajes efímeros / de una sola vista."""
    for _ in range(5):
        for wrapper in _WRAPPERS:
            inner = message.get(wrapper)
            if isinstance(inner, dict):
                inner_message = inner.get("message")
                message = inner_message if isinstance(inner_message, dict) else inner
                break
        else:
            return message
    return message


def _parse_timestamp(raw: Any) -> datetime | None:
    """`messageTimestamp` viene en segundos, a veces como string y a veces en
    milisegundos según la versión."""
    if isinstance(raw, bool) or raw is None:
        return None
    if isinstance(raw, dict):
        raw = raw.get("low", raw.get("seconds"))
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return None
    if value <= 0:
        return None
    if value > 1_000_000_000_000:
        value //= 1000
    try:
        return datetime.fromtimestamp(value, tz=timezone.utc)
    except (OverflowError, OSError, ValueError):
        return None


def _content_from_message(message: dict) -> tuple[str | None, str, dict | None] | None:
    """Traduce el mensaje de WhatsApp al modelo normalizado del hilo.

    Devuelve ``(content, message_type, payload)`` con la misma taxonomía que
    ``wsp_messages`` (ver models/schemas.py:MessageType), para que el frontend
    renderice el historial con la misma lógica que los mensajes propios:
    ``content`` es solo texto humano (caption/cuerpo, o None), ``message_type``
    el discriminador, y ``payload`` los datos estructurados del tipo. Devuelve
    None si el mensaje no se debe mostrar.
    """
    if not isinstance(message, dict):
        return None

    message = _unwrap_message(message)

    for skipped in _SKIPPED_TYPES:
        if skipped in message:
            return None

    conversation = message.get("conversation")
    if isinstance(conversation, str) and conversation:
        return conversation, "text", None

    extended = message.get("extendedTextMessage")
    if isinstance(extended, dict):
        text = extended.get("text")
        if isinstance(text, str) and text:
            return text, "text", None

    image = message.get("imageMessage")
    if isinstance(image, dict):
        return _caption(image) or None, "image", None

    video = message.get("videoMessage")
    if isinstance(video, dict):
        return _caption(video) or None, "video", None

    audio = message.get("audioMessage")
    if isinstance(audio, dict):
        return None, "audio", None

    document = message.get("documentMessage")
    if isinstance(document, dict):
        name = document.get("fileName") or document.get("title") or "Documento"
        return None, "document", {"filename": name}

    location = message.get("locationMessage")
    if isinstance(location, dict):
        lat = location.get("degreesLatitude")
        lon = location.get("degreesLongitude")
        if isinstance(lat, (int, float)) and isinstance(lon, (int, float)):
            return None, "location", {"latitude": lat, "longitude": lon}
        return None, "location", None

    if isinstance(message.get("stickerMessage"), dict):
        return None, "sticker", None

    contact = message.get("contactMessage")
    if isinstance(contact, dict):
        name = contact.get("displayName") or "sin nombre"
        return None, "contact", {"contacts": [{"fullName": name}]}

    contacts_array = message.get("contactsArrayMessage")
    if isinstance(contacts_array, dict):
        entries = contacts_array.get("contacts")
        contacts = [
            {"fullName": c.get("displayName") or "sin nombre"}
            for c in entries
            if isinstance(c, dict)
        ] if isinstance(entries, list) else []
        return None, "contact", {"contacts": contacts} if contacts else None

    poll = message.get("pollCreationMessage") or message.get("pollCreationMessageV3")
    if isinstance(poll, dict):
        options = poll.get("options")
        values = [
            o.get("optionName")
            for o in options
            if isinstance(o, dict) and isinstance(o.get("optionName"), str)
        ] if isinstance(options, list) else []
        question = poll.get("name") if isinstance(poll.get("name"), str) else None
        return question, "poll", {"values": values} if values else None

    interactive = _interactive_content(message)
    if interactive is not None:
        return interactive

    if isinstance(message.get("templateMessage"), dict):
        return None, "template", None

    if not message:
        return None

    return None, "unsupported", {"original_type": next(iter(message), "unknown")}


def _interactive_content(message: dict) -> tuple[str | None, str, dict | None] | None:
    """Texto legible de un mensaje interactivo (lista/botón), priorizando la
    respuesta que eligió el cliente."""
    response = message.get("buttonsResponseMessage") or message.get("templateButtonReplyMessage")
    if isinstance(response, dict):
        text = response.get("selectedDisplayText")
        selected_id = response.get("selectedButtonId") or response.get("selectedId")
        return (
            text if isinstance(text, str) else None,
            "interactive",
            {"selected_id": selected_id, "selected_text": text} if selected_id or text else None,
        )

    list_response = message.get("listResponseMessage")
    if isinstance(list_response, dict):
        text = list_response.get("title")
        reply = list_response.get("singleSelectReply")
        selected_id = reply.get("selectedRowId") if isinstance(reply, dict) else None
        return (
            text if isinstance(text, str) else None,
            "interactive",
            {"selected_id": selected_id, "selected_text": text} if selected_id or text else None,
        )

    for key in ("buttonsMessage", "listMessage", "interactiveMessage"):
        node = message.get(key)
        if isinstance(node, dict):
            title = node.get("title") or node.get("contentText")
            return title if isinstance(title, str) else None, "interactive", None

    return None


def _caption(media: dict) -> str:
    caption = media.get("caption")
    return caption if isinstance(caption, str) else ""


def _normalize_record(record: dict) -> dict | None:
    """Una fila de Evolution al shape que consume el hilo, o None si se omite."""
    key = record.get("key")
    if not isinstance(key, dict):
        return None

    wa_message_id = key.get("id")
    if not wa_message_id:
        return None

    from_me = key.get("fromMe")
    if not isinstance(from_me, bool):
        return None

    sent_at = _parse_timestamp(record.get("messageTimestamp"))
    if sent_at is None:
        return None

    parsed = _content_from_message(record.get("message") or {})
    if parsed is None:
        return None
    content, message_type, payload = parsed

    return {
        "wa_message_id": str(wa_message_id),
        "sender": "vendedor" if from_me else "cliente",
        "content": content,
        "sent_at": sent_at,
        # Taxonomía propia (no el messageType crudo de Evolution): es lo que el
        # frontend usa para elegir ícono/render, igual que en los mensajes propios.
        "message_type": message_type,
        "payload": payload,
    }


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


async def _estimate_start_page(chat_id: str) -> int:
    """Primera página de Evolution que probablemente tenga mensajes nuevos.

    Evolution pagina del más nuevo al más viejo, igual que la base, así que
    las primeras páginas son justo lo que ya está registrado. Se saltean
    tantas páginas como mensajes propios haya, con una de margen para no
    pasarse del límite entre historial y registro.
    """
    db_count = await count_wa_messages(chat_id)
    return max(1, db_count // HISTORY_PAGE_SIZE - 1)


async def fetch_whatsapp_history(
    chat_id: str,
    evolution_page: int | None = None,
    before_ts: datetime | None = None,
) -> dict:
    """Tramo del historial de WhatsApp anterior a `before_ts`.

    `evolution_page` es el cursor opaco que devolvió la llamada anterior; en
    la primera se estima a partir de cuántos mensajes del chat hay en la base.
    """
    boundary = _as_utc(before_ts)

    probing = False
    if evolution_page is not None:
        page = evolution_page
    elif boundary is not None:
        page = await _estimate_start_page(chat_id)
        probing = page > 1
    else:
        page = 1

    collected: list[dict] = []
    corrections = 0
    calls = 0
    exhausted = False

    while calls < MAX_EVOLUTION_CALLS and len(collected) < HISTORY_PAGE_SIZE:
        payload = await find_chat_messages(chat_id, page)
        calls += 1
        records, total_pages, _ = _extract_records(payload)

        normalized = [n for n in (_normalize_record(r) for r in records) if n]

        # La estimación se pasó de largo: la página entera quedó por detrás
        # del límite, así que en el medio pueden haber quedado mensajes sin
        # mostrar. Se retrocede a la mitad y se vuelve a probar.
        if (
            probing
            and normalized
            and corrections < MAX_PAGE_CORRECTIONS
            and all(n["sent_at"] < boundary for n in normalized)
        ):
            previous = page
            page = max(1, page // 2)
            corrections += 1
            if page == previous:
                probing = False
            else:
                continue
        probing = False

        if boundary is not None:
            normalized = [n for n in normalized if n["sent_at"] < boundary]

        if normalized:
            known = await existing_wa_message_ids(
                chat_id, [n["wa_message_id"] for n in normalized]
            )
            collected.extend(n for n in normalized if n["wa_message_id"] not in known)

        if total_pages is not None:
            exhausted = page >= total_pages
        else:
            exhausted = len(records) < HISTORY_PAGE_SIZE

        if exhausted:
            break
        page += 1

    seen: set[str] = set()
    unique: list[dict] = []
    for item in sorted(collected, key=lambda n: (n["sent_at"], n["wa_message_id"])):
        if item["wa_message_id"] in seen:
            continue
        seen.add(item["wa_message_id"])
        unique.append(item)

    return {
        "items": [
            {
                "wa_message_id": n["wa_message_id"],
                "sender": n["sender"],
                "content": n["content"],
                "sent_at": n["sent_at"].strftime("%Y-%m-%dT%H:%M:%S.%fZ"),
                "message_type": n["message_type"],
                "payload": n["payload"],
            }
            for n in unique
        ],
        "has_more": not exhausted,
        # Al salir del bucle sin agotar el historial, `page` ya quedó apuntando
        # a la primera página sin leer.
        "next_page": None if exhausted else page,
    }

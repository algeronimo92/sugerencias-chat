"""Historial de un chat leído directamente de WhatsApp (Evolution API).

Estos mensajes NO se guardan: son anteriores al registro propio y se muestran
al vuelo, solo de lectura. Por eso el shape de salida es parecido al de
`wsp_messages` pero sin `id` local, sin estado de entrega y sin multimedia
descargada — de un adjunto viejo se muestra el tipo y el epígrafe, no el
archivo.

La forma de la respuesta de `chat/findMessages` cambió entre versiones de
Evolution, así que todo lo que se lee de ahí se trata como no confiable.
"""

import json
import logging
import re
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

# Envoltorios transparentes que WhatsApp pone alrededor del mensaje real.
# Los de visualización única se tratan aparte: no deben desarmarse como una
# imagen/video común porque eso haría parecer que el archivo es persistente.
_WRAPPERS = (
    "ephemeralMessage",
    "documentWithCaptionMessage",
)

_VIEW_ONCE_WRAPPERS = (
    "viewOnceMessage",
    "viewOnceMessageV2",
    "viewOnceMessageV2Extension",
)

_VIEW_ONCE_MEDIA = (
    ("imageMessage", "image"),
    ("videoMessage", "video"),
    ("ptvMessage", "ptv"),
    ("audioMessage", "audio"),
    ("documentMessage", "document"),
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
    """Desanida envoltorios transparentes; nunca los de visualización única."""
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


def _view_once_media(message: dict, depth: int = 0) -> tuple[str, dict] | None:
    """Encuentra el adjunto interno sin devolver URLs, claves ni bytes.

    Evolution ha serializado estos wrappers con uno o dos niveles ``message``
    según la versión. El límite evita recorrer estructuras externas sin fin.
    """
    if depth >= 7 or not isinstance(message, dict):
        return None
    for key, kind in _VIEW_ONCE_MEDIA:
        media = message.get(key)
        if isinstance(media, dict):
            return kind, media
    for key in ("message", *_WRAPPERS, *_VIEW_ONCE_WRAPPERS):
        nested = message.get(key)
        if isinstance(nested, dict):
            found = _view_once_media(nested, depth + 1)
            if found is not None:
                return found
    return None


def _view_once_content(
    message: dict, depth: int = 0,
) -> tuple[str | None, str, dict | None] | None:
    """Reconoce view-once, conservando solo tipo y caption no sensibles."""
    if depth >= 7 or not isinstance(message, dict):
        return None
    for wrapper in _VIEW_ONCE_WRAPPERS:
        node = message.get(wrapper)
        if not isinstance(node, dict):
            continue
        found = _view_once_media(node)
        inner_type, media = found if found is not None else ("unknown", {})
        caption = _caption(media) or None
        return caption, "view_once", {
            "original_type": wrapper,
            "inner_type": inner_type,
        }
    for wrapper in ("message", *_WRAPPERS):
        node = message.get(wrapper)
        if isinstance(node, dict):
            found = _view_once_content(node, depth + 1)
            if found is not None:
                return found
    return None


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


_VCARD_WAID = re.compile(r"waid=(\d+)", re.IGNORECASE)
# El TEL puede venir agrupado con un prefijo ("item1.TEL"), que es como lo
# manda WhatsApp desde Android.
_VCARD_TEL = re.compile(r"^(?:[A-Za-z0-9-]+\.)?TEL[^:\r\n]*:(.*)$", re.IGNORECASE | re.MULTILINE)


def _contact_entry(contact: dict) -> dict:
    """Un contacto compartido, con el teléfono sacado del vCard.

    El número solo viaja dentro del vCard: ``waid`` lo trae en formato
    internacional (es el JID sin dominio) y el valor visible del ``TEL`` suele
    venir en formato local. Sin él el frontend no puede ofrecer abrirle el
    chat, que es lo único que se hace con un contacto compartido.
    """
    vcard = contact.get("vcard")
    vcard = vcard if isinstance(vcard, str) else ""
    tel = _VCARD_TEL.search(vcard)
    waid = _VCARD_WAID.search(vcard)
    phone = waid.group(1) if waid else (tel.group(1).strip() if tel else None)
    return {
        "fullName": contact.get("displayName") or "sin nombre",
        "phoneNumber": phone,
    }


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

    view_once = _view_once_content(message)
    if view_once is not None:
        return view_once

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

    ptv = message.get("ptvMessage")
    if isinstance(ptv, dict):
        return _caption(ptv) or None, "ptv", None

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
        return None, "contact", {"contacts": [_contact_entry(contact)]}

    contacts_array = message.get("contactsArrayMessage")
    if isinstance(contacts_array, dict):
        entries = contacts_array.get("contacts")
        contacts = [
            _contact_entry(c) for c in entries if isinstance(c, dict)
        ] if isinstance(entries, list) else []
        return None, "contact", {"contacts": contacts} if contacts else None

    poll = next((
        message.get(key)
        for key in (
            "pollCreationMessage", "pollCreationMessageV2", "pollCreationMessageV3",
            "pollCreationMessageV4", "pollCreationMessageV5",
        )
        if isinstance(message.get(key), dict)
    ), None)
    if isinstance(poll, dict):
        options = poll.get("options")
        values = [
            o.get("optionName")
            for o in options
            if isinstance(o, dict) and isinstance(o.get("optionName"), str)
        ] if isinstance(options, list) else []
        question = poll.get("name") if isinstance(poll.get("name"), str) else None
        return question, "poll", {"values": values} if values else None

    poll_snapshot = message.get("pollResultSnapshotMessage") or message.get(
        "pollResultSnapshotMessageV3"
    )
    if isinstance(poll_snapshot, dict):
        name = _first_text(poll_snapshot.get("name")) or "Resultados de encuesta"
        return name, "poll", {
            "original_type": "pollResultSnapshotMessage",
            "results": _poll_snapshot_results(poll_snapshot.get("pollVotes")),
        }

    order = message.get("orderMessage")
    if isinstance(order, dict):
        payload = _order_payload(order)
        content = _first_text(order.get("message"), order.get("orderTitle"))
        return content or "Pedido de WhatsApp", "order", payload

    product = message.get("productMessage")
    if isinstance(product, dict):
        payload = _product_payload(product)
        content = _first_text(payload.get("title"), product.get("body"))
        return content or "Producto de WhatsApp", "product", payload

    payment_type, payment = next((
        (key, message.get(key))
        for key in (
            "invoiceMessage", "requestPaymentMessage", "sendPaymentMessage",
            "paymentInviteMessage", "cancelPaymentRequestMessage",
            "declinePaymentRequestMessage",
        )
        if isinstance(message.get(key), dict)
    ), (None, None))
    if payment_type and isinstance(payment, dict):
        payload = _payment_payload(payment_type, payment)
        return _first_text(payload.get("note"), payload.get("status")) or "Pago de WhatsApp", "payment", payload

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

    native_response = message.get("interactiveResponseMessage")
    if isinstance(native_response, dict):
        native = native_response.get("nativeFlowResponseMessage")
        params: dict = {}
        if isinstance(native, dict):
            raw = native.get("paramsJson")
            if isinstance(raw, str):
                try:
                    parsed = json.loads(raw)
                    params = parsed if isinstance(parsed, dict) else {}
                except (TypeError, ValueError):
                    pass
        selected_text = _first_text(
            params.get("display_text"), params.get("title"),
            (native_response.get("body") or {}).get("text")
                if isinstance(native_response.get("body"), dict) else None,
        )
        selected_id = params.get("id") or params.get("selected_id")
        return selected_text, "interactive", {
            "original_type": "interactiveResponseMessage",
            "selected_id": selected_id,
            "selected_text": selected_text,
        }

    for key in ("buttonsMessage", "listMessage", "interactiveMessage"):
        node = message.get(key)
        if isinstance(node, dict):
            payload = _interactive_payload(key, node)
            content = _first_text(payload.get("body"), payload.get("title"), payload.get("flow_text"))
            return content, "interactive", payload

    return None


def _caption(media: dict) -> str:
    caption = media.get("caption")
    return caption if isinstance(caption, str) else ""


_CURRENCY_SYMBOLS = {"PEN": "S/", "USD": "$"}

_PAYMENT_STATUS_LABELS = {
    "captured": "Realizado",
    "pending": "Pendiente",
    "failed": "Fallido",
    "canceled": "Cancelado",
    "cancelled": "Cancelado",
    "declined": "Rechazado",
    "refunded": "Reembolsado",
}

_ORDER_STATUS_LABELS = {
    "completed": "Completado",
    "payment_requested": "Pendiente de pago",
    "canceled": "Cancelado",
    "cancelled": "Cancelado",
    "declined": "Rechazado",
    "processing": "En proceso",
}


def _humanize(raw: str | None) -> str | None:
    if not raw:
        return None
    text = raw.replace("_", " ")
    return text[:1].upper() + text[1:]


def _format_payment_text(button: dict) -> str | None:
    amount = button.get("amount")
    if amount is None:
        return None
    currency = button.get("currency")
    symbol = _CURRENCY_SYMBOLS.get(currency, f"{currency} " if currency else "")
    amount_text = f"{symbol}{amount:.2f}"
    label = button.get("item_name")
    if label:
        return f"Solicitud de pago: {label} - {amount_text}"
    return f"Solicitud de pago - {amount_text}"


def _format_flow_text(button: dict) -> str | None:
    """Texto legible para las actualizaciones de un pedido de WhatsApp Flow
    (creación, cambio de estado de pago, cambio de estado del pedido).
    Cada una llega como un botón distinto de `nativeFlowMessage` con su
    propio `name`, por eso se resuelve por ese campo."""
    name = button.get("name")
    if name == "payment_status" and button.get("payment_status"):
        status = button["payment_status"]
        return f"Pago: {_PAYMENT_STATUS_LABELS.get(status) or _humanize(status)}"
    if name == "review_order" and button.get("order_status"):
        status = button["order_status"]
        return f"Estado: {_ORDER_STATUS_LABELS.get(status) or _humanize(status)}"
    if name == "review_and_pay":
        return _format_payment_text(button)
    return None


def _flow_buttons_payload(node: dict) -> tuple[list[dict], str | None]:
    """Botones de `nativeFlowMessage` (ej. solicitudes de pago vía WhatsApp
    Flow). `buttonParamsJson` trae campos propios por tipo de botón (pago,
    cita, etc.) que no calzan con el resto de mensajes interactivos, por eso
    se procesan aparte."""
    native_flow = node.get("nativeFlowMessage") if isinstance(node.get("nativeFlowMessage"), dict) else {}
    raw_buttons = native_flow.get("buttons") if isinstance(native_flow.get("buttons"), list) else []
    buttons = []
    flow_text = None
    for button in raw_buttons:
        if not isinstance(button, dict):
            continue
        params = {}
        raw_params = button.get("buttonParamsJson")
        if isinstance(raw_params, str):
            try:
                parsed = json.loads(raw_params)
                params = parsed if isinstance(parsed, dict) else {}
            except (TypeError, ValueError):
                pass
        order = params.get("order") if isinstance(params.get("order"), dict) else {}
        items = order.get("items") if isinstance(order.get("items"), list) else []
        total_amount = params.get("total_amount") if isinstance(params.get("total_amount"), dict) else {}
        amount = None
        total_value, total_offset = total_amount.get("value"), total_amount.get("offset")
        if isinstance(total_value, (int, float)) and isinstance(total_offset, (int, float)) and total_offset:
            amount = total_value / total_offset
        subtotal_amount = order.get("subtotal") if isinstance(order.get("subtotal"), dict) else {}
        subtotal = None
        subtotal_value, subtotal_offset = subtotal_amount.get("value"), subtotal_amount.get("offset")
        if isinstance(subtotal_value, (int, float)) and isinstance(subtotal_offset, (int, float)) and subtotal_offset:
            subtotal = subtotal_value / subtotal_offset
        item = items[0] if items and isinstance(items[0], dict) else {}
        item_name = item.get("name") or params.get("additional_note")
        button_text = button.get("buttonText")
        entry = {
            "id": button.get("buttonId") or button.get("id") or params.get("id"),
            "text": button_text.get("displayText") if isinstance(button_text, dict) else None,
            "name": button.get("name") or params.get("type"),
            "amount": amount,
            "subtotal": subtotal,
            "currency": params.get("currency"),
            "reference_id": params.get("reference_id"),
            "order_status": order.get("status"),
            "payment_status": params.get("payment_status"),
            "item_name": item_name.strip() if isinstance(item_name, str) else item_name,
            "quantity": item.get("quantity"),
        }
        buttons.append({key: value for key, value in entry.items() if value not in (None, "")})
        if flow_text is None:
            flow_text = _format_flow_text(entry)
    return buttons, flow_text


def _interactive_payload(message_type: str, node: dict) -> dict:
    body = node.get("body") if isinstance(node.get("body"), dict) else {}
    header = node.get("header") if isinstance(node.get("header"), dict) else {}
    footer = node.get("footer") if isinstance(node.get("footer"), dict) else {}
    options = []
    sections = node.get("sections") if isinstance(node.get("sections"), list) else []
    for section in sections:
        if not isinstance(section, dict):
            continue
        rows = section.get("rows") if isinstance(section.get("rows"), list) else []
        for row in rows:
            if isinstance(row, dict):
                options.append({
                    "id": row.get("rowId") or row.get("id"),
                    "text": row.get("title") or row.get("name"),
                    "description": row.get("description"),
                })
    buttons, flow_text = _flow_buttons_payload(node)
    result = {
        "original_type": message_type,
        "title": node.get("title") or header.get("title"),
        "body": body.get("text") or node.get("contentText") or node.get("description"),
        "footer": footer.get("text") or node.get("footerText"),
        "options": options,
        "buttons": buttons,
        "flow_text": flow_text,
    }
    return {key: value for key, value in result.items() if value not in (None, [], "")}


def _first_text(*values: Any) -> str | None:
    for value in values:
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _long_value(value: Any) -> int | str | None:
    """Normaliza los Long de protobuf que Evolution serializa de varias formas."""
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, str)):
        return value
    if isinstance(value, dict):
        low = value.get("low")
        high = value.get("high", 0)
        if isinstance(low, int) and isinstance(high, int):
            # Reconstrucción con signo equivalente a Long de protobuf.
            return (high << 32) + (low & 0xFFFFFFFF)
    return None


def _order_payload(order: dict) -> dict:
    """Datos estables de orderMessage; omite token y demás campos sensibles."""
    result = {
        "original_type": "orderMessage",
        "order_id": order.get("orderId"),
        "title": order.get("orderTitle"),
        "message": order.get("message"),
        "item_count": _long_value(order.get("itemCount")),
        "status": order.get("status"),
        "surface": order.get("surface"),
        "total_amount_1000": _long_value(order.get("totalAmount1000")),
        "currency": order.get("totalCurrencyCode"),
    }
    return {key: value for key, value in result.items() if value is not None}


def _poll_snapshot_results(raw: Any) -> list[dict]:
    if not isinstance(raw, list):
        return []
    results = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        voters = item.get("voters") if isinstance(item.get("voters"), list) else []
        option = _first_text(item.get("optionName"), item.get("option"), item.get("name"))
        if option:
            results.append({"option": option, "count": len(voters), "voters": voters})
    return results


def _product_payload(message: dict) -> dict:
    product = message.get("product") if isinstance(message.get("product"), dict) else {}
    result = {
        "original_type": "productMessage",
        "product_id": product.get("productId"),
        "retailer_id": product.get("retailerId"),
        "title": product.get("title"),
        "description": product.get("description"),
        "body": message.get("body"),
        "footer": message.get("footer"),
        "price_amount_1000": _long_value(product.get("priceAmount1000")),
        "sale_price_amount_1000": _long_value(product.get("salePriceAmount1000")),
        "currency": product.get("currencyCode"),
        "url": product.get("url") or product.get("signedUrl"),
        "image_url": (product.get("productImage") or {}).get("url")
            if isinstance(product.get("productImage"), dict) else None,
    }
    return {key: value for key, value in result.items() if value is not None}


def _payment_payload(message_type: str, payment: dict) -> dict:
    amount = payment.get("amount1000") or payment.get("amount")
    currency = payment.get("currencyCode") or payment.get("currency")
    result = {
        "original_type": message_type,
        "payment_kind": message_type.removesuffix("Message"),
        "transaction_id": payment.get("transactionId") or payment.get("paymentRequestId"),
        "amount_1000": _long_value(amount),
        "currency": currency,
        "note": payment.get("noteMessage") or payment.get("note") or payment.get("message"),
        "status": payment.get("status") or payment.get("serviceType"),
        "expiry_timestamp": _long_value(payment.get("expiryTimestamp")),
    }
    return {key: value for key, value in result.items() if value is not None}


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

"""Traducción de un mensaje de WhatsApp al modelo normalizado del hilo.

`MESSAGE_PARSERS` mapea cada clave que WhatsApp puede traer (`imageMessage`,
`orderMessage`, …) al constructor que la entiende. El orden del registro es el
orden en que se resuelve: una clave más específica va antes que una genérica
que también podría matchear, y un parser que devuelve None deja pasar a la
siguiente clave. Lo que no reconoce nadie cae en `unsupported` con su tipo
original, que es como se descubre qué manda esta cuenta.
"""

import json
from collections.abc import Callable

from services.whatsapp_history.envelope import (
    _SKIPPED_TYPES,
    _parse_timestamp,
    _unwrap_message,
    _view_once_content,
)
from services.whatsapp_history.payloads import (
    _caption,
    _contact_entry,
    _first_text,
    _interactive_payload,
    _order_payload,
    _payment_payload,
    _poll_snapshot_results,
    _product_payload,
)

Parsed = tuple[str | None, str, dict | None]
MessageParser = Callable[[object, dict], Parsed | None]


def _text(node, _message):
    return (node, "text", None) if isinstance(node, str) and node else None


def _extended_text(node, _message):
    if not isinstance(node, dict):
        return None
    text = node.get("text")
    return (text, "text", None) if isinstance(text, str) and text else None


def _captioned_media(kind: str) -> MessageParser:
    def parse(node, _message):
        return (_caption(node) or None, kind, None) if isinstance(node, dict) else None

    return parse


def _audio(node, _message):
    return (None, "audio", None) if isinstance(node, dict) else None


def _document(node, _message):
    if not isinstance(node, dict):
        return None
    name = node.get("fileName") or node.get("title") or "Documento"
    return None, "document", {"filename": name}


def _location(node, message):
    if not isinstance(node, dict):
        return None
    live = message.get("liveLocationMessage")
    lat, lon = node.get("degreesLatitude"), node.get("degreesLongitude")
    payload = {"live": True} if live is not None else None
    if isinstance(lat, (int, float)) and isinstance(lon, (int, float)):
        payload = {**(payload or {}), "latitude": lat, "longitude": lon}
    return None, "location", payload


def _sticker(node, _message):
    return (None, "sticker", None) if isinstance(node, dict) else None


def _pin(node, _message):
    if not isinstance(node, dict):
        return None
    target = node.get("key") if isinstance(node.get("key"), dict) else {}
    action = "unpin" if node.get("type") in (2, "UNPIN_FOR_ALL") else "pin"
    content = "Desfijó un mensaje" if action == "unpin" else "Fijó un mensaje"
    return content, "pin", {"action": action, "target_wa_message_id": target.get("id")}


def _contact(node, _message):
    if not isinstance(node, dict):
        return None
    return None, "contact", {"contacts": [_contact_entry(node)]}


def _contacts_array(node, _message):
    if not isinstance(node, dict):
        return None
    entries = node.get("contacts")
    contacts = [
        entry for entry in entries if isinstance(entry, dict)
    ] if isinstance(entries, list) else []
    parsed = [_contact_entry(entry) for entry in contacts]
    return None, "contact", {"contacts": parsed} if parsed else None


def _poll(node, _message):
    if not isinstance(node, dict):
        return None
    options = node.get("options")
    values = [
        option.get("optionName")
        for option in options
        if isinstance(option, dict) and isinstance(option.get("optionName"), str)
    ] if isinstance(options, list) else []
    question = node.get("name") if isinstance(node.get("name"), str) else None
    return question, "poll", {"values": values} if values else None


def _poll_snapshot(node, _message):
    if not isinstance(node, dict):
        return None
    name = _first_text(node.get("name")) or "Resultados de encuesta"
    return name, "poll", {
        "original_type": "pollResultSnapshotMessage",
        "results": _poll_snapshot_results(node.get("pollVotes")),
    }


def _order(node, _message):
    if not isinstance(node, dict):
        return None
    content = _first_text(node.get("message"), node.get("orderTitle"))
    return content or "Pedido de WhatsApp", "order", _order_payload(node)


def _product(node, _message):
    if not isinstance(node, dict):
        return None
    payload = _product_payload(node)
    content = _first_text(payload.get("title"), node.get("body"))
    return content or "Producto de WhatsApp", "product", payload


def _payment(key: str) -> MessageParser:
    def parse(node, _message):
        if not isinstance(node, dict):
            return None
        payload = _payment_payload(key, node)
        content = _first_text(payload.get("note"), payload.get("status"))
        return content or "Pago de WhatsApp", "payment", payload

    return parse


def _button_reply(node, _message):
    if not isinstance(node, dict):
        return None
    text = node.get("selectedDisplayText")
    selected_id = node.get("selectedButtonId") or node.get("selectedId")
    return (
        text if isinstance(text, str) else None,
        "interactive",
        {"selected_id": selected_id, "selected_text": text} if selected_id or text else None,
    )


def _list_reply(node, _message):
    if not isinstance(node, dict):
        return None
    text = node.get("title")
    reply = node.get("singleSelectReply")
    selected_id = reply.get("selectedRowId") if isinstance(reply, dict) else None
    return (
        text if isinstance(text, str) else None,
        "interactive",
        {"selected_id": selected_id, "selected_text": text} if selected_id or text else None,
    )


def _native_flow_reply(node, _message):
    if not isinstance(node, dict):
        return None
    native = node.get("nativeFlowResponseMessage")
    params: dict = {}
    if isinstance(native, dict):
        raw = native.get("paramsJson")
        if isinstance(raw, str):
            try:
                parsed = json.loads(raw)
                params = parsed if isinstance(parsed, dict) else {}
            except (TypeError, ValueError):
                pass
    body = node.get("body") if isinstance(node.get("body"), dict) else {}
    selected_text = _first_text(
        params.get("display_text"), params.get("title"), body.get("text"),
    )
    selected_id = params.get("id") or params.get("selected_id")
    return selected_text, "interactive", {
        "original_type": "interactiveResponseMessage",
        "selected_id": selected_id,
        "selected_text": selected_text,
    }


def _interactive(key: str) -> MessageParser:
    def parse(node, _message):
        if not isinstance(node, dict):
            return None
        payload = _interactive_payload(key, node)
        content = _first_text(payload.get("body"), payload.get("title"), payload.get("flow_text"))
        return content, "interactive", payload

    return parse


def _template(node, _message):
    return (None, "template", None) if isinstance(node, dict) else None


MESSAGE_PARSERS: dict[str, MessageParser] = {
    "conversation": _text,
    "extendedTextMessage": _extended_text,
    "imageMessage": _captioned_media("image"),
    "videoMessage": _captioned_media("video"),
    "ptvMessage": _captioned_media("ptv"),
    "audioMessage": _audio,
    "documentMessage": _document,
    "locationMessage": _location,
    "liveLocationMessage": _location,
    "stickerMessage": _sticker,
    "lottieStickerMessage": _sticker,
    "pinInChatMessage": _pin,
    "contactMessage": _contact,
    "contactsArrayMessage": _contacts_array,
    "pollCreationMessage": _poll,
    "pollCreationMessageV2": _poll,
    "pollCreationMessageV3": _poll,
    "pollCreationMessageV4": _poll,
    "pollCreationMessageV5": _poll,
    "pollResultSnapshotMessage": _poll_snapshot,
    "pollResultSnapshotMessageV3": _poll_snapshot,
    "orderMessage": _order,
    "productMessage": _product,
    "invoiceMessage": _payment("invoiceMessage"),
    "requestPaymentMessage": _payment("requestPaymentMessage"),
    "sendPaymentMessage": _payment("sendPaymentMessage"),
    "paymentInviteMessage": _payment("paymentInviteMessage"),
    "cancelPaymentRequestMessage": _payment("cancelPaymentRequestMessage"),
    "declinePaymentRequestMessage": _payment("declinePaymentRequestMessage"),
    "buttonsResponseMessage": _button_reply,
    "templateButtonReplyMessage": _button_reply,
    "listResponseMessage": _list_reply,
    "interactiveResponseMessage": _native_flow_reply,
    "buttonsMessage": _interactive("buttonsMessage"),
    "listMessage": _interactive("listMessage"),
    "interactiveMessage": _interactive("interactiveMessage"),
    "templateMessage": _template,
}


def _unsupported(message: dict) -> Parsed | None:
    if not message:
        return None
    original_type = next(iter(message), "unknown")
    payload = {"original_type": original_type}
    # `secretEncType` distingue qué acción cifrada es (2 = edición, ya
    # manejada aparte vía /message-edited-secret). Cualquier otro valor cae
    # acá sin descifrar — se guarda para poder ver en la base qué otros tipos
    # manda esta cuenta, ya que WhatsApp no publica este enum.
    if original_type == "secretEncryptedMessage":
        secret = message.get("secretEncryptedMessage")
        if isinstance(secret, dict) and "secretEncType" in secret:
            payload["secret_enc_type"] = secret.get("secretEncType")
    return None, "unsupported", payload


def _content_from_message(message: dict) -> Parsed | None:
    """Devuelve ``(content, message_type, payload)`` con la misma taxonomía que
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

    if any(skipped in message for skipped in _SKIPPED_TYPES):
        return None

    for key, parse in MESSAGE_PARSERS.items():
        if key not in message:
            continue
        parsed = parse(message[key], message)
        if parsed is not None:
            return parsed

    return _unsupported(message)


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

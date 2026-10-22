"""Proyección de texto de un mensaje de Meta para la IA y la búsqueda.

Lee el mensaje con su estructura original (``provider_payload``) y devuelve
una línea legible. No inventa contenido: un pedido se describe con sus
productos, cantidades y precios literales; un tipo desconocido se nombra con
su tipo literal.
"""

from __future__ import annotations

import json
from typing import Any

MEDIA_LABELS = {
    "image": "imagen",
    "video": "video",
    "audio": "audio",
    "document": "documento",
    "sticker": "sticker",
}


def _object(value: Any) -> dict:
    return value if isinstance(value, dict) else {}


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _order(order: dict) -> str:
    items = []
    for item in order.get("product_items") or []:
        item = _object(item)
        items.append(
            f"{item.get('quantity')} x {item.get('product_retailer_id')}"
            f" ({item.get('item_price')} {item.get('currency')})"
        )
    text = _text(order.get("text"))
    return "Pedido: " + "; ".join(items) + (f". {text}" if text else "")


def _location(location: dict) -> str:
    place = _text(location.get("name")) or _text(location.get("address"))
    coords = f"{location.get('latitude')}, {location.get('longitude')}"
    return f"Ubicación: {place} ({coords})" if place else f"Ubicación: {coords}"


def _contacts(contacts: list) -> str:
    rendered = []
    for contact in contacts:
        contact = _object(contact)
        name = _text(_object(contact.get("name")).get("formatted_name"))
        phones = ", ".join(
            _text(_object(phone).get("phone")) for phone in contact.get("phones") or [] if _object(phone).get("phone")
        )
        rendered.append(f"{name} {phones}".strip())
    return "Contacto compartido: " + "; ".join(rendered)


def _interactive(interactive: dict, subtype: str | None) -> str:
    reply = _object(interactive.get(subtype or ""))
    if subtype == "button_reply":
        return f"Tocó el botón: {_text(reply.get('title'))} (id {reply.get('id')})"
    if subtype == "list_reply":
        return f"Eligió de la lista: {_text(reply.get('title'))} (id {reply.get('id')})"
    if subtype == "nfm_reply":
        raw = reply.get("response_json")
        try:
            data = json.loads(raw) if isinstance(raw, str) else raw
        except ValueError:
            data = raw
        return f"Respondió el formulario {reply.get('name') or ''}: {json.dumps(data, ensure_ascii=False)}".strip()
    body = _text(_object(interactive.get("body")).get("text"))
    return body or f"Mensaje interactivo {subtype}"


def message_text(
    message_type: str | None,
    message_subtype: str | None,
    content: str | None,
    provider_payload: dict | None,
) -> str:
    """Línea de texto para un mensaje, con su contenido si lo tiene."""
    content = _text(content)
    message = _object(provider_payload)
    if message_type in MEDIA_LABELS:
        return f"[{MEDIA_LABELS[message_type]}] {content}".strip()
    if message_type == "location":
        return _location(_object(message.get("location")))
    if message_type == "contacts":
        return _contacts(message.get("contacts") or [])
    if message_type == "order":
        return _order(_object(message.get("order")))
    if message_type == "interactive":
        return _interactive(_object(message.get("interactive")), message_subtype)
    if message_type == "button":
        button = _object(message.get("button"))
        return f"Tocó el botón de la plantilla: {_text(button.get('text'))} (payload {button.get('payload')})"
    if message_type == "template":
        return content or f"Plantilla {_object(message.get('template')).get('name')}"
    if message_type in {"unknown", "unsupported"}:
        errors = message.get("errors") or []
        title = _text(_object(errors[0]).get("title")) if errors else ""
        return f"[mensaje no soportado por WhatsApp{': ' + title if title else ''}]"
    if content:
        return content
    return f"[{message_type or 'mensaje'}]"

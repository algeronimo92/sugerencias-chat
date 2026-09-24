"""Proyecciones de un mensaje de Meta para la UI, la búsqueda y la IA.

Nada de esto reemplaza al mensaje: ``provider_payload`` guarda el objeto
completo y estas funciones solo leen de él. Una raíz sin proyección conocida
(un tipo que Meta agregue mañana) devuelve una proyección vacía y el mensaje
se guarda igual con su tipo literal.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from services.meta_contract import contract, message_subtype


@dataclass(frozen=True)
class Projection:
    content: str | None
    media_id: str | None = None
    media_filename: str | None = None


def _text(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    return value.strip() or None


def _nested(message: dict, key: str) -> dict:
    value = message.get(key)
    return value if isinstance(value, dict) else {}


def _media(message: dict) -> Projection:
    root = message.get("type")
    media = _nested(message, root)
    filename = _text(media.get("filename")) if root == "document" else None
    return Projection(
        content=_text(media.get("caption")) or filename,
        media_id=_text(media.get("id")),
        media_filename=filename,
    )


def _location(message: dict) -> Projection:
    location = _nested(message, "location")
    return Projection(content=_text(location.get("name")) or _text(location.get("address")))


def _contacts(message: dict) -> Projection:
    names = [
        _text(_nested(contact, "name").get("formatted_name"))
        for contact in message.get("contacts") or []
        if isinstance(contact, dict)
    ]
    return Projection(content=", ".join(name for name in names if name) or None)


def _interactive(message: dict) -> Projection:
    subtype = message_subtype(message)
    reply = _nested(_nested(message, "interactive"), subtype or "")
    if subtype == "nfm_reply":
        return Projection(content=_text(reply.get("body")) or _text(reply.get("name")))
    return Projection(content=_text(reply.get("title")) or _text(reply.get("id")))


PROJECTIONS: dict[str, Callable[[dict], Projection]] = {
    "text": lambda message: Projection(content=_text(_nested(message, "text").get("body"))),
    "location": _location,
    "contacts": _contacts,
    "interactive": _interactive,
    "button": lambda message: Projection(content=_text(_nested(message, "button").get("text"))),
    "order": lambda message: Projection(content=_text(_nested(message, "order").get("text"))),
    "system": lambda message: Projection(content=_text(_nested(message, "system").get("body"))),
}


def project(message: dict) -> Projection:
    root = message.get("type")
    if root in contract().media_root_types:
        return _media(message)
    build = PROJECTIONS.get(root) if isinstance(root, str) else None
    return build(message) if build else Projection(content=None)


def quoted_wa_message_id(message: dict) -> str | None:
    return _text(_nested(message, "context").get("id"))


def reply_identifier(message_type: str | None, provider_payload: dict | None) -> str | None:
    """Id que eligió el cliente al responder, tal como lo manda Meta.

    ``interactive.button_reply.id`` y ``list_reply.id`` son los ids que puso
    el negocio en el mensaje interactivo; ``button.payload`` es el payload del
    botón de respuesta rápida de una plantilla. None si no es una respuesta.
    """
    message = provider_payload if isinstance(provider_payload, dict) else {}
    if message_type == "interactive":
        interactive = _nested(message, "interactive")
        subtype = interactive.get("type")
        if subtype in {"button_reply", "list_reply"}:
            return _text(_nested(interactive, subtype).get("id"))
    if message_type == "button":
        return _text(_nested(message, "button").get("payload"))
    return None

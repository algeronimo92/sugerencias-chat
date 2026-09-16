"""Sobre del mensaje: cómo viene envuelto y fechado, antes de mirar su tipo.

La forma de la respuesta de `chat/findMessages` cambió entre versiones de
Evolution, así que todo lo que se lee de ahí se trata como no confiable."""

from datetime import datetime, timezone
from typing import Any

from services.whatsapp_history.payloads import _caption


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


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)

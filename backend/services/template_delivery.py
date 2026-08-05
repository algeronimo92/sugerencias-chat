from collections.abc import Iterable
from typing import Any

from services.evolution_service import mediatype_from_content_type


MEDIA_CAPTION_MAX_LENGTH = 1024
_NATIVE_CAPTION_MEDIA_TYPES = frozenset({"image", "video", "document"})


def _field(item: Any, name: str):
    return item.get(name) if isinstance(item, dict) else getattr(item, name)


def build_internal_template_items(text: str, attachments: Iterable[Any]) -> list[dict]:
    """Construye la cola de una plantilla interna con caption cuando aplica.

    Evolution envía imagen/video/documento por ``sendMedia`` y acepta el
    caption en ese mismo request. Audio no tiene caption nativo en WhatsApp;
    si solo hay audios (o el texto supera el límite del caption), el contenido
    conserva el envío separado de texto para no truncarlo ni perderlo.
    """
    normalized_text = text.strip()
    media = list(attachments)
    caption_index: int | None = None
    if normalized_text and len(normalized_text) <= MEDIA_CAPTION_MAX_LENGTH:
        caption_index = next((
            index
            for index, attachment in enumerate(media)
            if mediatype_from_content_type(_field(attachment, "content_type"))
            in _NATIVE_CAPTION_MEDIA_TYPES
        ), None)

    items: list[dict] = []
    if normalized_text and caption_index is None:
        items.append({
            "content": normalized_text,
            "payload": {"type": "text", "text": normalized_text},
        })

    for index, attachment in enumerate(media):
        media_url = _field(attachment, "media_url")
        mediatype = mediatype_from_content_type(_field(attachment, "content_type"))
        caption = normalized_text if index == caption_index else None
        items.append({
            "content": caption,
            "media_url": media_url,
            "payload": {
                "type": "media",
                "media_url": media_url,
                "mediatype": mediatype,
                "filename": _field(attachment, "filename"),
                "caption": caption,
            },
        })
    return items

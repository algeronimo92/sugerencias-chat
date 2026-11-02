from collections.abc import Iterable
from typing import Any

from app.modules.conversations.ports.message_media import (mediatype_from_content_type)
from app.integrations.meta.contract import limit
from app.integrations.meta.outbound import media_item, text_item


MEDIA_CAPTION_MAX_LENGTH = limit("caption")
_NATIVE_CAPTION_MEDIA_TYPES = frozenset({"image", "video", "document"})


def _field(item: Any, name: str):
    return item.get(name) if isinstance(item, dict) else getattr(item, name)


def build_internal_template_items(text: str, attachments: Iterable[Any]) -> list[dict]:
    """Construye la cola de una plantilla interna con caption cuando aplica.

    Imagen, video y documento aceptan el caption en el mismo mensaje. Audio
    no tiene caption en WhatsApp; si solo hay audios (o el texto supera el
    límite del caption), el texto va como mensaje aparte para no truncarlo.
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
        items.append(text_item(normalized_text))

    for index, attachment in enumerate(media):
        content_type = _field(attachment, "content_type")
        items.append(media_item(
            _field(attachment, "media_url"),
            mediatype_from_content_type(content_type),
            filename=_field(attachment, "filename"),
            caption=normalized_text if index == caption_index else None,
            content_type=content_type,
        ))
    return items

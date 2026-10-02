"""Forma única de un mensaje hacia la API (schema ``Message``).

La usan el hilo paginado, las mutaciones que devuelven la fila y los avisos
en tiempo real: los tres tienen que exponer los mismos campos del contrato.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from app.db.store_common import _fmt_ts

MESSAGE_FIELDS = (
    "id",
    "chat_id",
    "sender",
    "direction",
    "content",
    "sent_at",
    "media_url",
    "wa_message_id",
    "outbox_status",
    "meta_status",
    "status_payload",
    "message_type",
    "message_subtype",
    "provider_payload",
    "analysis",
    "payload",
    "reactions",
    "edited_at",
    "deleted_at",
    "pinned_at",
    "media_width",
    "media_height",
    "quoted_wa_message_id",
)

_TIMESTAMPS = frozenset({"sent_at", "edited_at", "deleted_at", "pinned_at"})


def _get(source: Any, field: str) -> Any:
    if isinstance(source, Mapping):
        return source.get(field)
    return getattr(source, field, None)


def mask_deleted(item: dict) -> dict:
    """Vacía lo que un mensaje eliminado ya no debe mostrar.

    El borrado es lógico (la fila queda para la auditoría del CRM), así que el
    ocultamiento se hace al servir. ``sender``, ``sent_at`` y los estados se
    conservan: son los que ubican la lápida en el hilo.
    """
    if not item.get("deleted_at"):
        return item
    return {
        **item,
        "content": None,
        "media_url": None,
        "analysis": None,
        "payload": None,
        "provider_payload": None,
        "media_width": None,
        "media_height": None,
    }


def serialize_message(source: Any) -> dict:
    """Fila ORM o mapping de una consulta -> dict del schema ``Message``."""
    item: dict[str, Any] = {}
    for field in MESSAGE_FIELDS:
        value = _get(source, field)
        if field in _TIMESTAMPS:
            value = _fmt_ts(value)
        elif field in {"media_width", "media_height"}:
            # 0/0 marca "no medible": al frontend no le sirve, se expone None.
            value = value or None
        item[field] = value
    return mask_deleted(item)

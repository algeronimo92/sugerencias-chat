"""Normalización de eventos de estado enviados por Evolution API.

Evolution ha emitido dos variantes de ``MESSAGES_UPDATE`` según la versión
y el adaptador: estados con nombre (``DELIVERY_ACK``) o códigos numéricos,
y el estado puede venir en ``data.status`` o ``data.update.status``.  n8n
también puede enviar el contrato plano que ya usaba la aplicación.
"""

from collections.abc import Iterator
from typing import Any

from domain_types import MessageStatus


_STATUS_BY_CODE = {
    2: MessageStatus.SERVER_ACK,
    3: MessageStatus.DELIVERY_ACK,
    4: MessageStatus.READ,
    5: MessageStatus.PLAYED,
}

_STATUS_ALIASES = {
    "SERVER_ACK": MessageStatus.SERVER_ACK,
    "SENT": MessageStatus.SERVER_ACK,
    "DELIVERY_ACK": MessageStatus.DELIVERY_ACK,
    "DELIVERED": MessageStatus.DELIVERY_ACK,
    "READ": MessageStatus.READ,
    "PLAYED": MessageStatus.PLAYED,
}

MESSAGE_STATUS_RANK = {
    MessageStatus.SERVER_ACK: 1,
    MessageStatus.DELIVERY_ACK: 2,
    MessageStatus.READ: 3,
    MessageStatus.PLAYED: 4,
}


def normalize_message_status(value: Any) -> MessageStatus | None:
    """Convierte nombres y códigos de Evolution al enum interno."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return _STATUS_BY_CODE.get(value)
    if not isinstance(value, str):
        return None

    cleaned = value.strip().upper().replace("-", "_").replace(" ", "_")
    if cleaned.isdigit():
        return _STATUS_BY_CODE.get(int(cleaned))
    return _STATUS_ALIASES.get(cleaned)


def _event_items(payload: Any) -> Iterator[dict[str, Any]]:
    if isinstance(payload, list):
        for item in payload:
            yield from _event_items(item)
        return
    if not isinstance(payload, dict):
        return

    # ``data`` es el sobre nativo de Evolution. ``body``/``payload`` cubren
    # los flujos de n8n que reenvían el webhook original sin transformarlo.
    for wrapper in ("data", "body", "payload"):
        nested = payload.get(wrapper)
        if isinstance(nested, (dict, list)):
            yield from _event_items(nested)
            return
    yield payload


def _message_id(item: dict[str, Any]) -> str | None:
    # keyId es key.id de WhatsApp. messageId, cuando Evolution guarda datos,
    # es el ID interno de su propia tabla Message y no sirve para relacionar
    # el evento con la respuesta de sendText/sendMedia.
    for field in ("wa_message_id", "keyId"):
        value = item.get(field)
        if isinstance(value, str) and value.strip():
            return value.strip()

    key = item.get("key")
    if isinstance(key, dict):
        value = key.get("id")
        if isinstance(value, str) and value.strip():
            return value.strip()

    value = item.get("messageId")
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _status(item: dict[str, Any]) -> MessageStatus | None:
    status = normalize_message_status(item.get("status"))
    if status is not None:
        return status
    update = item.get("update")
    if isinstance(update, dict):
        return normalize_message_status(update.get("status"))
    return None


def parse_message_status_updates(payload: Any) -> list[tuple[str, MessageStatus]]:
    """Extrae y deduplica actualizaciones de un payload plano o nativo.

    Si el mismo mensaje aparece varias veces en un lote, conserva el estado
    más avanzado para que el orden del lote no produzca regresiones.
    """
    updates: dict[str, MessageStatus] = {}
    for item in _event_items(payload):
        wa_message_id = _message_id(item)
        status = _status(item)
        if wa_message_id is None or status is None:
            continue
        current = updates.get(wa_message_id)
        if current is None or MESSAGE_STATUS_RANK[status] > MESSAGE_STATUS_RANK[current]:
            updates[wa_message_id] = status
    return list(updates.items())

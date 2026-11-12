from __future__ import annotations

import asyncio
import base64
import logging
from datetime import datetime, timezone
from typing import Any

from app.integrations.evolution_webhook.inbox import InboxEvent
from app.integrations.whatsapp.identity import ContactIdentity, resolve_whatsapp_identity
from app.modules.conversations.ports.inbound import (
    attach_media,
    receive_provider_message,
    record_provider_status,
)
from app.modules.media.ports.media_upload import save_decoded_media
from app.tenancy.context import tenant_context
from app.tenancy.resolver import resolve_tenant_by_phone_number_id

logger = logging.getLogger(__name__)


def _timestamp(value: Any) -> datetime | None:
    try:
        return datetime.fromtimestamp(int(value), tz=timezone.utc)
    except (TypeError, ValueError, OverflowError, OSError):
        return None


def _jid_number(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    head, _, suffix = value.partition("@")
    return head if suffix == "s.whatsapp.net" and head.isdigit() else None


def _identity(instance: str, data: dict, payload: dict | None = None) -> ContactIdentity:
    key = data.get("key") if isinstance(data.get("key"), dict) else {}
    remote = key.get("remoteJid")
    alternate = key.get("remoteJidAlt")
    sender = (
        (payload or {}).get("sender")
        or data.get("sender")
        or data.get("participant")
        or key.get("participant")
    )
    wa_id = _jid_number(alternate) or _jid_number(sender) or _jid_number(remote)
    lid = remote if isinstance(remote, str) and remote.endswith("@lid") else None
    return ContactIdentity(
        phone_number_id=instance,
        wa_id=wa_id,
        user_id=lid,
        profile_name=data.get("pushName") if isinstance(data.get("pushName"), str) else None,
    )


def _project(data: dict) -> tuple[dict, str, str | None, str | None, str | None]:
    message = data.get("message") if isinstance(data.get("message"), dict) else {}
    kind = data.get("messageType")
    if kind == "conversation":
        content = message.get("conversation")
        return ({"type": "text", "text": {"body": content or ""}}, "text", None, content, None)
    if kind == "extendedTextMessage":
        nested = message.get(kind) if isinstance(message.get(kind), dict) else {}
        context = nested.get("contextInfo") if isinstance(nested.get("contextInfo"), dict) else {}
        content = nested.get("text")
        return (
            {"type": "text", "text": {"body": content or ""}, "context": {"id": context.get("stanzaId")}},
            "text", None, content, context.get("stanzaId"),
        )
    roots = {
        "imageMessage": "image",
        "videoMessage": "video",
        "audioMessage": "audio",
        "documentMessage": "document",
    }
    root = roots.get(str(kind))
    if root:
        nested = message.get(str(kind)) if isinstance(message.get(str(kind)), dict) else {}
        context = nested.get("contextInfo") if isinstance(nested.get("contextInfo"), dict) else {}
        projected = {
            "type": root,
            root: {
                "caption": nested.get("caption"),
                "filename": nested.get("fileName"),
                "mime_type": nested.get("mimetype"),
            },
        }
        return projected, root, None, nested.get("caption") or nested.get("fileName"), context.get("stanzaId")
    return ({"type": str(kind or "unknown"), "evolution": message}, str(kind or "unknown"), None, None, None)


async def _save_media(data: dict, stored: dict) -> None:
    message = data.get("message") if isinstance(data.get("message"), dict) else {}
    encoded = data.get("base64") or message.get("base64")
    if not isinstance(encoded, str) or not encoded or stored.get("media_url"):
        return
    if "," in encoded:
        encoded = encoded.split(",", 1)[1]
    kind = data.get("messageType")
    nested = message.get(kind) if isinstance(message.get(kind), dict) else {}
    content_type = nested.get("mimetype") or "application/octet-stream"
    filename = nested.get("fileName")
    try:
        raw = base64.b64decode(encoded)
        media_url = await asyncio.to_thread(save_decoded_media, content_type, raw, filename)
    except Exception:
        # El archivo viene inline: si no se puede decodificar, reintentar el
        # evento no lo va a arreglar. El mensaje queda guardado sin adjunto.
        logger.exception("No se pudo guardar el adjunto Evolution %s", stored["id"])
        return
    await attach_media(stored["chat_id"], stored["id"], media_url)


async def _message(instance: str, data: dict, event: InboxEvent) -> None:
    key = data.get("key") if isinstance(data.get("key"), dict) else {}
    if key.get("fromMe") or not isinstance(key.get("id"), str):
        return
    identity = _identity(instance, data, event.payload)
    resolved = await resolve_whatsapp_identity(identity)
    payload, message_type, subtype, content, quoted = _project(data)
    stored, _ = await receive_provider_message(
        chat_id=resolved.chat_id,
        sender="cliente",
        wa_message_id=key["id"],
        message_type=message_type,
        message_subtype=subtype,
        provider_payload={"evolution": data, **payload},
        content=content,
        sent_at=_timestamp(data.get("messageTimestamp")),
        quoted_wa_message_id=quoted,
        webhook_event_id=event.id,
        channel_provider="evolution",
        channel_connection=instance,
    )
    await _save_media(data, stored)


STATUS_MAP = {
    "PENDING": "sent",
    "SERVER_ACK": "sent",
    "DELIVERY_ACK": "delivered",
    "READ": "read",
    "PLAYED": "read",
    "ERROR": "failed",
}


async def _status(data: dict, event: InboxEvent) -> None:
    key = data.get("key") if isinstance(data.get("key"), dict) else {}
    update = data.get("update") if isinstance(data.get("update"), dict) else {}
    raw = update.get("status") or data.get("status")
    message_id = key.get("id")
    status = STATUS_MAP.get(str(raw).upper())
    if isinstance(message_id, str) and status:
        await record_provider_status(
            {"id": message_id, "status": status, "evolution": data},
            occurred_at=_timestamp(data.get("messageTimestamp")),
            webhook_event_id=event.id,
        )


async def process_event(event: InboxEvent) -> None:
    payload = event.payload
    instance = payload.get("instance")
    if not isinstance(instance, str) or not instance:
        raise ValueError("Evento Evolution sin instancia")
    context = await resolve_tenant_by_phone_number_id(instance)
    if context is None:
        raise ValueError(f"Instancia Evolution sin tenant activo: {instance}")
    event_type = str(payload.get("event") or "").lower().replace("_", ".")
    data = payload.get("data")
    rows = data if isinstance(data, list) else [data]
    with tenant_context(context):
        for row in rows:
            if not isinstance(row, dict):
                continue
            if event_type == "messages.upsert":
                await _message(instance, row, event)
            elif event_type == "messages.update":
                await _status(row, event)

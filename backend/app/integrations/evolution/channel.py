"""Adaptador de mensajería esencial de Evolution al contrato interno Meta-like."""

from __future__ import annotations

import base64

from app.integrations.evolution import client
from app.integrations.whatsapp.channel import ChannelAvailability, ChannelError, SendReceipt
from app.integrations.whatsapp.identity import resolve_whatsapp_destination


def _message_id(payload: dict) -> str | None:
    key = payload.get("key") if isinstance(payload.get("key"), dict) else {}
    value = key.get("id") or payload.get("id") or payload.get("messageId")
    return str(value) if value else None


async def _destination(chat_id: str) -> str:
    destination = await resolve_whatsapp_destination(chat_id)
    if destination.wa_id and destination.wa_id.isdigit():
        return destination.wa_id
    raise ChannelError("El contacto no tiene un número utilizable por Evolution API")


class EvolutionMessageSender:
    def __init__(self, instance: str):
        self.instance = instance

    async def send(self, chat_id: str, message: dict) -> SendReceipt:
        number = await _destination(chat_id)
        kind = message.get("type")
        if kind == "text":
            nested = message.get("text") or {}
            response = await client.send_text(self.instance, number, str(nested.get("body") or ""))
        elif kind in {"image", "video", "document", "audio"}:
            nested = message.get(kind) if isinstance(message.get(kind), dict) else {}
            media = nested.get("id")
            if not isinstance(media, str) or not media:
                raise ChannelError("El adjunto no quedó preparado para Evolution API")
            response = await client.send_media(
                self.instance,
                number,
                mediatype=kind,
                media=media,
                caption=nested.get("caption"),
                filename=nested.get("filename"),
            )
        else:
            raise ChannelError(f"Evolution todavía no admite mensajes de tipo {kind}", status_code=400)
        return SendReceipt(
            provider_message_id=_message_id(response),
            sent_body={"to": number, **message},
            recipient_wa_id=number,
        )

    async def upload_media(self, content: bytes, content_type: str, filename: str) -> str:
        # Evolution espera base64 puro: con un data URI el prefijo se decodifica
        # como si fuera parte del archivo y lo corrompe.
        return base64.b64encode(content).decode("ascii")


class EvolutionConversationActions:
    def __init__(self, instance: str):
        self.instance = instance

    async def mark_read(self, chat_id: str, provider_message_ids: list[str]) -> None:
        number = await _destination(chat_id)
        await client.mark_read(self.instance, number, provider_message_ids)


class EvolutionChannelStatus:
    def __init__(self, instance: str):
        self.instance = instance

    async def availability(self) -> ChannelAvailability:
        return ChannelAvailability(integration="WHATSAPP-BAILEYS", configured=True)

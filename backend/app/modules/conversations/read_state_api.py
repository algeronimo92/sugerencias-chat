"""Adaptador HTTP de la bandeja: marcar un chat visto o pendiente."""

import logging

import httpx

from app.integrations.whatsapp.channel import ChannelError
from app.integrations.whatsapp.channels import current_channel
from app.integrations.whatsapp.identity import InvalidWhatsAppIdentityError
from app.modules.conversations.application.inbox import mark_read, mark_unread
from app.modules.conversations.common import chats_router
from app.modules.conversations.inbox_queries import fetch_unread_wa_message_ids


router = chats_router()
logger = logging.getLogger(__name__)


@router.post("/{chat_id}/read")
async def read_chat(chat_id: str):
    """Marca el chat como visto por el vendedor — resetea unread_count a 0 y
    le avisa a WhatsApp (tiques azules del lado del cliente) de los mensajes
    que todavía no se habían marcado como leídos."""
    # Antes de marcar: después ya no cuentan como "sin ver".
    wa_message_ids = await fetch_unread_wa_message_ids(chat_id)
    if wa_message_ids:
        try:
            await current_channel().actions.mark_read(chat_id, wa_message_ids)
        except (ChannelError, httpx.HTTPError, InvalidWhatsAppIdentityError) as exc:
            # Best-effort: si Meta falla igual se marca como visto de nuestro
            # lado; no tiene sentido bloquear el badge interno por un problema
            # ajeno a nuestra base.
            logger.warning(
                "No se pudieron marcar %d mensajes como leídos en Meta para %s: %s",
                len(wa_message_ids), chat_id, exc,
            )
    await mark_read(chat_id)
    return {"status": "ok"}


@router.post("/{chat_id}/unread")
async def unread_chat(chat_id: str):
    """Marca el chat como pendiente dentro del CRM. No revierte los recibos
    de lectura ya enviados a WhatsApp."""
    await mark_unread(chat_id)
    return {"status": "ok"}

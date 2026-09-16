import logging

import httpx

from fastapi import HTTPException
from services.db_service import fetch_unread_wa_message_ids, mark_chat_read, mark_chat_unread
from services.whatsapp_channel import ChannelError
from services.whatsapp_channels import current_channel
from services.whatsapp_identity_service import InvalidWhatsAppIdentityError
from services.ws_manager import manager
from routers.chats.common import chats_router


router = chats_router()
logger = logging.getLogger(__name__)


@router.post("/{chat_id}/read")
async def read_chat(chat_id: str):
    """Marca el chat como visto por el vendedor — resetea unread_count a 0 y
    le avisa a WhatsApp (tiques azules del lado del cliente) de los mensajes
    que todavía no se habían marcado como leídos."""
    wa_message_ids = await fetch_unread_wa_message_ids(chat_id)
    if wa_message_ids:
        try:
            await current_channel().actions.mark_read(chat_id, wa_message_ids)
        except (ChannelError, httpx.HTTPError, InvalidWhatsAppIdentityError) as exc:
            # Best-effort: si Meta falla (no configurada, mensaje ya no existe
            # del lado de WhatsApp, etc.) igual se marca como visto de nuestro
            # lado — no tiene sentido bloquear el badge interno por un problema
            # ajeno a nuestra base.
            logger.warning(
                "No se pudieron marcar %d mensajes como leídos en Meta para %s: %s",
                len(wa_message_ids),
                chat_id,
                exc,
            )

    await mark_chat_read(chat_id)
    await manager.broadcast({"type": "chats_updated", "chat_id": chat_id, "reason": "read"})
    return {"status": "ok"}


@router.post("/{chat_id}/unread")
async def unread_chat(chat_id: str):
    """Marca el chat como pendiente dentro del CRM. No revierte los recibos
    de lectura ya enviados a WhatsApp."""
    if not await mark_chat_unread(chat_id):
        raise HTTPException(404, "El chat no tiene mensajes del cliente para marcar")
    await manager.broadcast({"type": "chats_updated", "chat_id": chat_id, "reason": "unread"})
    return {"status": "ok"}

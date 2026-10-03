"""Adaptador HTTP de las acciones sobre un mensaje: reaccionar y fijar."""

import logging

import httpx
from fastapi import Depends, HTTPException

from app.db.models.auth import User
from app.integrations.whatsapp.channel import ChannelError, describe_send_failure
from app.modules.auth.public import get_current_user
from app.modules.conversations.application.inbox import pin_message, unpin_message
from app.modules.conversations.application.outbound import send_reaction
from app.modules.conversations.common import chats_router
from app.modules.conversations.domain.errors import MessageNotConfirmed, MessageNotFound
from app.modules.conversations.message_history import fetch_pinned_messages, fetch_reply_target
from app.modules.conversations.schemas import Message, PinnedMessagesResponse, ReactionRequest


router = chats_router()
logger = logging.getLogger(__name__)


@router.post("/{chat_id}/messages/{message_id}/reaction", response_model=Message)
async def react_to_message(chat_id: str, message_id: int, body: ReactionRequest):
    """Reacciona (o quita la reacción) del vendedor sobre un mensaje del chat.

    Manda primero a WhatsApp y recién si eso funciona guarda el evento y el
    badge: una reacción que solo se viera de nuestro lado engañaría al
    vendedor haciéndole creer que el cliente la vio."""
    target = await fetch_reply_target(chat_id, message_id)
    if target is None:
        raise MessageNotFound()
    if not target["wa_message_id"]:
        # Un mensaje del vendedor todavía en la outbox no tiene id de WhatsApp:
        # no se le puede reaccionar hasta que se confirme el envío.
        raise MessageNotConfirmed("El mensaje todavía no está confirmado en WhatsApp")
    try:
        return await send_reaction(chat_id, target["wa_message_id"], body.emoji)
    except (ChannelError, httpx.HTTPError) as exc:
        logger.warning("No se pudo enviar la reacción a WhatsApp para %s: %s", chat_id, exc)
        raise HTTPException(502, describe_send_failure(exc, "enviar la reacción a WhatsApp")) from exc


@router.get("/{chat_id}/pinned-messages", response_model=PinnedMessagesResponse)
async def get_pinned_messages(chat_id: str):
    return {"items": await fetch_pinned_messages(chat_id)}


@router.post("/{chat_id}/messages/{message_id}/pin", response_model=Message)
async def pin_chat_message(chat_id: str, message_id: int, user: User = Depends(get_current_user)):
    """Fija un mensaje, como el "Fijar" de WhatsApp — pero solo dentro del CRM:
    Meta no expone forma de fijar un mensaje del lado de quien envía, así que
    esto no se refleja en el WhatsApp del cliente."""
    return await pin_message(chat_id, message_id, user.id)


@router.post("/{chat_id}/messages/{message_id}/unpin", response_model=Message)
async def unpin_chat_message(chat_id: str, message_id: int):
    return await unpin_message(chat_id, message_id)

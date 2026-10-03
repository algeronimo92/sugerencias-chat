"""Casos de uso de la bandeja: marcar visto o pendiente, fijar mensajes."""

from __future__ import annotations

from datetime import datetime, timezone

from app.db.uow import collect, unit_of_work
from app.modules.conversations.application.ports import conversation_ports
from app.modules.conversations.domain.errors import MessageNotFound
from app.modules.conversations.domain.events import ChatMarkedUnread, ChatRead, MessagePinChanged


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def mark_read(chat_id: str) -> None:
    """El vendedor vio el chat. Los recibos de lectura hacia WhatsApp los
    manda quien llama, antes, porque necesitan los mensajes todavía sin ver."""
    async with unit_of_work():
        await conversation_ports().inbox.mark_read(chat_id, _now())
        collect(ChatRead(chat_id=chat_id))


async def mark_unread(chat_id: str) -> None:
    """Deja el chat pendiente dentro del CRM, sin tocar los recibos de
    lectura ya enviados a WhatsApp."""
    async with unit_of_work():
        if not await conversation_ports().inbox.mark_unread(chat_id):
            raise MessageNotFound("El chat no tiene mensajes del cliente para marcar")
        collect(ChatMarkedUnread(chat_id=chat_id))


async def pin_message(chat_id: str, message_id: int, user_id: int) -> dict:
    """Fija un mensaje dentro del CRM (Meta no permite fijar desde el lado de
    quien envía). Idempotente: fijar uno ya fijado no cambia su lugar."""
    async with unit_of_work():
        message = await conversation_ports().messages.pin(chat_id, message_id, user_id, _now())
        if message is None:
            raise MessageNotFound()
        collect(MessagePinChanged(chat_id=chat_id, message_id=message_id))
    return message


async def unpin_message(chat_id: str, message_id: int) -> dict:
    async with unit_of_work():
        message = await conversation_ports().messages.unpin(chat_id, message_id)
        if message is None:
            raise MessageNotFound()
        collect(MessagePinChanged(chat_id=chat_id, message_id=message_id))
    return message

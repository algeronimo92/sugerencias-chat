import asyncio
import logging
from datetime import datetime

from services.db_service import fetch_latest_message_cursor, fetch_messages_after_cursor
from services.ws_manager import manager
from services.automation_service import trigger_inbound_message

logger = logging.getLogger(__name__)

# Respaldo del webhook de n8n (routers/webhooks.py) por si esa llamada llegara a fallar.
POLL_INTERVAL_SECONDS = 60
MESSAGE_BATCH_SIZE = 500


async def process_chat_changes(
    cursor: tuple[datetime, int] | None,
) -> tuple[datetime, int] | None:
    """Procesa todos los mensajes posteriores al cursor y devuelve el nuevo.

    El cursor anterior basado en una firma global terminaba recuperando solo el
    último mensaje. Si dos chats cambiaban dentro del mismo minuto, los mensajes
    intermedios nunca llegaban a ``trigger_inbound_message``.
    """
    latest = None
    while True:
        batch = await fetch_messages_after_cursor(cursor, MESSAGE_BATCH_SIZE)
        if not batch:
            break
        for next_cursor, message in batch:
            await trigger_inbound_message(message)
            cursor = next_cursor
            latest = message
        if len(batch) < MESSAGE_BATCH_SIZE:
            break

    if latest is not None:
        await manager.broadcast({
            "type": "chats_updated",
            "reason": "external_message",
            "latest_message": latest,
            "chat_id": latest["chat_id"],
        })
    return cursor


async def watch_chats() -> None:
    """Sondea la DB y procesa en orden todos los mensajes insertados por fuera."""
    cursor = await fetch_latest_message_cursor()
    while True:
        await asyncio.sleep(POLL_INTERVAL_SECONDS)
        try:
            cursor = await process_chat_changes(cursor)
        except Exception:
            logger.exception("Error watching chats for changes")

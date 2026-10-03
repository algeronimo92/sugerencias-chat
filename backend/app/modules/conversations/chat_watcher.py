import asyncio
import logging
from datetime import datetime

from app.core.events import publish
from app.modules.conversations.domain.events import ExternalMessageDetected, ExternalMessagesSynced
from app.modules.conversations.message_queries import fetch_latest_message_cursor, fetch_messages_after_cursor

logger = logging.getLogger(__name__)

# Respaldo del webhook de n8n (app/integrations/n8n/api.py) por si esa llamada llegara a fallar.
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
            # Estricto: si una automatización no se pudo agendar, la pasada se
            # corta sin mover el cursor y el próximo ciclo la reintenta (las
            # ejecuciones se deduplican por event_key).
            await publish(ExternalMessageDetected(chat_id=message["chat_id"], message=message), strict=True)
            cursor = next_cursor
            latest = message
        if len(batch) < MESSAGE_BATCH_SIZE:
            break

    if latest is not None:
        await publish(ExternalMessagesSynced(chat_id=latest["chat_id"], latest=latest))
    return cursor


async def watch_chats() -> None:
    """Sondea la DB y procesa en orden todos los mensajes insertados por fuera."""
    cursor = await fetch_latest_message_cursor()
    while True:
        await asyncio.sleep(POLL_INTERVAL_SECONDS)
        try:
            cursor = await process_chat_changes(cursor)
        except Exception:
            logger.exception("Error al vigilar cambios en los chats")

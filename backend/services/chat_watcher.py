import asyncio
import logging

from services.db_service import fetch_chat_signature
from services.ws_manager import manager

logger = logging.getLogger(__name__)

# Respaldo del webhook de n8n (routers/webhooks.py) por si esa llamada llegara a fallar.
POLL_INTERVAL_SECONDS = 20


async def watch_chats() -> None:
    """Sondea la base de datos y avisa por websocket cuando cambia el orden/último mensaje de los chats."""
    last_signature: str | None = None
    while True:
        try:
            signature = await fetch_chat_signature()
            if last_signature is not None and signature != last_signature:
                await manager.broadcast({"type": "chats_updated"})
            last_signature = signature
        except Exception:
            logger.exception("Error watching chats for changes")
        await asyncio.sleep(POLL_INTERVAL_SECONDS)

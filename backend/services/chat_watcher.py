import asyncio
import logging

from services.db_service import fetch_chat_signature, fetch_latest_message
from services.ws_manager import manager
from services.automation_service import trigger_inbound_message

logger = logging.getLogger(__name__)

# Respaldo del webhook de n8n (routers/webhooks.py) por si esa llamada llegara a fallar.
POLL_INTERVAL_SECONDS = 60


async def watch_chats() -> None:
    """Sondea la base de datos y avisa por websocket cuando cambia el orden/último mensaje de los chats."""
    last_signature: str | None = None
    while True:
        try:
            signature = await fetch_chat_signature()
            if last_signature is not None and signature != last_signature:
                payload = {"type": "chats_updated", "reason": "external_message"}
                latest = await fetch_latest_message()
                if latest is not None:
                    payload["latest_message"] = latest
                    payload["chat_id"] = latest["chat_id"]
                    await trigger_inbound_message(latest)
                await manager.broadcast(payload)
            last_signature = signature
        except Exception:
            logger.exception("Error watching chats for changes")
        await asyncio.sleep(POLL_INTERVAL_SECONDS)

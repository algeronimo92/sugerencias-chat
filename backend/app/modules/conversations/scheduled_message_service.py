from app.modules.conversations import scheduled_message_repository
from app.modules.conversations.scheduled_message_policies import (CLAIM_LIMIT, STALE_PROCESSING_MINUTES, _item)
import asyncio
import logging
from datetime import datetime, timedelta, timezone


from app.db.models.leads import Lead
from app.db.models.conversations import ScheduledMessage
from app.db.models.auth import User
from domain_types import ScheduledMessageStatus
from app.realtime.ws_manager import manager
from app.core.time_format import iso_utc_micros
from app.modules.conversations.service_window import SERVICE_WINDOW_CLOSED_DETAIL, service_window_is_open
from app.modules.conversations.message_outbox import enqueue_text_message

logger = logging.getLogger(__name__)

POLL_SECONDS = 1.0
DISPATCH_CONCURRENCY = 10


async def list_scheduled_messages(lead_id: str) -> list[dict]:
    return await scheduled_message_repository.list_scheduled_messages(lead_id)


async def create_scheduled_message(lead_id: str, text: str, scheduled_at: datetime, user_id: int) -> dict | None:
    return await scheduled_message_repository.create_scheduled_message(lead_id, text, scheduled_at, user_id)


async def cancel_scheduled_message(scheduled_id: int, user_id: int, is_admin: bool) -> dict | None:
    return await scheduled_message_repository.cancel_scheduled_message(scheduled_id, user_id, is_admin)


async def _recover_stale() -> None:
    return await scheduled_message_repository._recover_stale()


async def _claim_due() -> list[int]:
    return await scheduled_message_repository._claim_due()


async def _dispatch(scheduled_id: int) -> None:
    """Encola el mensaje programado por la misma puerta que el resto.

    El encolado va fuera de la transacción que marca la fila como QUEUED, así
    que hay una ventana entre ambos. La hace segura el `dedupe_key`: si el
    proceso se cae en el medio, `_recover_stale` devuelve la fila a scheduled,
    el próximo intento vuelve a encolar con la misma clave y `enqueue_messages`
    devuelve el mensaje que ya existe en vez de crear otro.
    """
    now = datetime.now(timezone.utc)
    prepared = await scheduled_message_repository.prepare_dispatch(scheduled_id, now, service_window_is_open, SERVICE_WINDOW_CLOSED_DETAIL)
    if prepared is None:
        return
    lead_id, text, window_open = prepared

    status = ScheduledMessageStatus.FAILED
    if window_open:
        # Sin actor_user_id: no hay un vendedor mirando la app en este momento,
        # así que cuenta como "atendido por bot" y no como que un humano vio la
        # conversación (enqueue_messages resuelve el touch con ese criterio).
        message = await enqueue_text_message(
            lead_id, text, dedupe_key=f"scheduled:{scheduled_id}",
        )
        await scheduled_message_repository.mark_queued(scheduled_id, message["id"], datetime.now(timezone.utc))
        status = ScheduledMessageStatus.QUEUED

    if lead_id:
        await manager.broadcast({
            "type": "scheduled_messages_updated",
            "chat_id": lead_id,
            "status": status,
        })
        if status == ScheduledMessageStatus.QUEUED:
            await manager.broadcast({
                "type": "chats_updated",
                "chat_id": lead_id,
                "reason": "outbound_queued",
            })


async def watch_scheduled_messages() -> None:
    await _recover_stale()
    semaphore = asyncio.Semaphore(DISPATCH_CONCURRENCY)

    async def dispatch_bounded(scheduled_id: int) -> None:
        async with semaphore:
            await _dispatch(scheduled_id)

    while True:
        try:
            ids = await _claim_due()
            if ids:
                await asyncio.gather(*(dispatch_bounded(scheduled_id) for scheduled_id in ids))
                continue
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Error al procesar mensajes programados")
        await asyncio.sleep(POLL_SECONDS)

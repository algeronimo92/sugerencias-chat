"""Worker de los mensajes programados: reclama los que llegaron a su hora y
los despacha con ``dispatch_scheduled_message``."""

from __future__ import annotations

import asyncio
import logging

from app.modules.conversations.application.ports import conversation_ports
from app.modules.conversations.application.scheduling import dispatch_scheduled_message

logger = logging.getLogger(__name__)

POLL_SECONDS = 1.0
DISPATCH_CONCURRENCY = 10


async def watch_scheduled_messages() -> None:
    store = conversation_ports().scheduled
    await store.recover_stale()
    semaphore = asyncio.Semaphore(DISPATCH_CONCURRENCY)

    async def dispatch_bounded(scheduled_id: int) -> None:
        async with semaphore:
            try:
                await dispatch_scheduled_message(scheduled_id)
            except Exception:
                logger.exception("No se pudo despachar el mensaje programado %s", scheduled_id)

    while True:
        try:
            due = await store.claim_due()
            if due:
                await asyncio.gather(*(dispatch_bounded(scheduled_id) for scheduled_id in due))
                continue
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Error al procesar los mensajes programados")
        await asyncio.sleep(POLL_SECONDS)

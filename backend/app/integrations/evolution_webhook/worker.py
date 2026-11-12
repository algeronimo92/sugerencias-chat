import asyncio
import logging
import traceback
from time import monotonic

from app.db.signals import ring, signal
from app.integrations.evolution_webhook.inbox import claim_events, complete_event, purge_processed
from app.integrations.evolution_webhook.processor import process_event

logger = logging.getLogger(__name__)
SIGNAL = "evolution-inbox"


async def notify_new_events() -> None:
    await ring(SIGNAL)


async def drain_once(limit: int = 20) -> int:
    events = await claim_events(limit)
    for event in events:
        try:
            await process_event(event)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception("Falló el evento %s de Evolution", event.id)
            where = "".join(traceback.format_tb(exc.__traceback__)[-3:])
            await complete_event(event.id, error=f"{type(exc).__name__}: {exc}\n{where}")
        else:
            await complete_event(event.id)
    return len(events)


async def watch_evolution_webhook_inbox() -> None:
    next_purge_at = 0.0
    while True:
        try:
            if monotonic() >= next_purge_at:
                next_purge_at = monotonic() + 3600
                await purge_processed()
            if await drain_once():
                continue
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Error al vaciar el inbox de Evolution")
        await signal(SIGNAL).wait(2.0)

"""Worker global que vacía el inbox de Meta.

Es uno solo para toda la plataforma: el inbox vive en el plano de control y
cada evento abre el contexto de su negocio al procesarse. Los procesa en orden
de llegada y de a uno, para que un estado no se aplique antes que el mensaje
al que se refiere cuando llegaron en entregas seguidas.
"""

from __future__ import annotations

import asyncio
import logging
import traceback
from time import monotonic

from app.integrations.meta_webhook.inbox import InboxEvent, claim_events, complete_event, purge_processed
from app.integrations.meta_webhook.processor import process_change

logger = logging.getLogger(__name__)

BATCH_SIZE = 20
IDLE_POLL_SECONDS = 2.0
PURGE_INTERVAL_SECONDS = 3600.0

_wakeup = asyncio.Event()


def notify_new_events() -> None:
    """Despierta al worker apenas el webhook guardó eventos nuevos."""
    _wakeup.set()


async def run_event(event: InboxEvent) -> bool:
    """Procesa un evento y deja su resultado en el inbox. True si salió bien."""
    try:
        await process_change(event)
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        logger.exception("Falló el evento %s de Meta (intento %s)", event.id, event.attempts)
        # El final del traceback dice dónde falló sin tener que ir a buscar
        # el log de ese momento.
        where = "".join(traceback.format_tb(exc.__traceback__)[-3:])
        await complete_event(event.id, error=f"{type(exc).__name__}: {exc}\n{where}")
        return False
    await complete_event(event.id)
    return True


async def drain_once(limit: int = BATCH_SIZE) -> int:
    """Reclama y procesa una tanda. Devuelve cuántos eventos tomó."""
    events = await claim_events(limit)
    for event in events:
        await run_event(event)
    return len(events)


async def _wait_for_work() -> None:
    try:
        await asyncio.wait_for(_wakeup.wait(), timeout=IDLE_POLL_SECONDS)
    except asyncio.TimeoutError:
        pass
    finally:
        _wakeup.clear()


async def watch_meta_webhook_inbox() -> None:
    next_purge_at = 0.0
    while True:
        try:
            if monotonic() >= next_purge_at:
                next_purge_at = monotonic() + PURGE_INTERVAL_SECONDS
                await purge_processed()
            if await drain_once():
                continue
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Error al vaciar el inbox de Meta")
        await _wait_for_work()

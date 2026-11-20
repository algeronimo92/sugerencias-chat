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

from app.integrations.meta_webhook.inbox import (
    CALLS_EVENT_TYPE,
    CALLS_LANE,
    MESSAGES_LANE,
    InboxEvent,
    Lane,
    claim_events,
    complete_event,
    inbox_stats,
    purge_processed,
    release_event,
)
from app.integrations.meta_webhook import metrics
from app.integrations.meta_webhook.processor import process_change
from app.db.signals import ring, signal

logger = logging.getLogger(__name__)

BATCH_SIZE = 20
IDLE_POLL_SECONDS = 2.0
PURGE_INTERVAL_SECONDS = 3600.0

META_INBOX_SIGNAL = "meta-inbox"
# Señal propia: si los dos ciclos esperaran la misma, el primero en despertar
# la apaga y el otro duerme hasta su sondeo (2 s de una llamada sonando).
META_CALLS_SIGNAL = "meta-inbox-calls"
CALLS_IDLE_POLL_SECONDS = 1.0
METRICS_POLL_SECONDS = 30.0


async def notify_new_events(event_types: set[str] | None = None) -> None:
    """Despierta al ciclo que corresponda apenas el webhook guardó eventos
    nuevos, aunque el webhook haya entrado por otra réplica. Sin tipos,
    despierta a los dos."""
    if event_types is None or CALLS_EVENT_TYPE in event_types:
        await ring(META_CALLS_SIGNAL)
    if event_types is None or event_types - {CALLS_EVENT_TYPE}:
        await ring(META_INBOX_SIGNAL)


async def run_event(event: InboxEvent, *, release_on_cancel: bool = False) -> bool:
    """Procesa un evento y deja su resultado en el inbox. True si salió bien."""
    try:
        await process_change(event)
    except asyncio.CancelledError:
        if release_on_cancel:
            # Un deploy apaga el worker: el evento vuelve a la fila en vez de
            # esperar a que venza su reclamo.
            await asyncio.shield(release_event(event.id))
        raise
    except Exception as exc:
        logger.exception("Falló el evento %s de Meta (intento %s)", event.id, event.attempts)
        # El final del traceback dice dónde falló sin tener que ir a buscar
        # el log de ese momento.
        where = "".join(traceback.format_tb(exc.__traceback__)[-3:])
        # De una llamada no se guarda el texto del error: uno de validación
        # repite su entrada, y la entrada trae la oferta SDP.
        detail = type(exc).__name__ if event.event_type == CALLS_EVENT_TYPE else f"{type(exc).__name__}: {exc}"
        await complete_event(event.id, error=f"{detail}\n{where}")
        return False
    await complete_event(event.id)
    return True


async def drain_once(limit: int = BATCH_SIZE, *, lane: Lane = MESSAGES_LANE) -> int:
    """Reclama y procesa una tanda. Devuelve cuántos eventos tomó."""
    events = await claim_events(limit, lane=lane)
    for event in events:
        await run_event(event, release_on_cancel=lane is CALLS_LANE)
    return len(events)


async def _wait_for_work() -> None:
    await signal(META_INBOX_SIGNAL).wait(IDLE_POLL_SECONDS)


async def watch_meta_webhook_inbox() -> None:
    next_purge_at = 0.0
    while True:
        try:
            if monotonic() >= next_purge_at:
                next_purge_at = monotonic() + PURGE_INTERVAL_SECONDS
                await purge_processed()
            if await drain_once(lane=MESSAGES_LANE):
                continue
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Error al vaciar el inbox de Meta")
        await _wait_for_work()


async def watch_meta_calls_inbox() -> None:
    """El carril de las llamadas: de a un evento, para que una llamada nunca
    espere detrás de otra tanda ni detrás de un mensaje."""
    while True:
        try:
            if await drain_once(1, lane=CALLS_LANE):
                continue
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Error al vaciar el carril de llamadas de Meta")
        await signal(META_CALLS_SIGNAL).wait(CALLS_IDLE_POLL_SECONDS)


async def update_inbox_metrics() -> None:
    stats = await inbox_stats()
    metrics.webhook_inbox_pending.set(stats.pending)
    metrics.webhook_inbox_exhausted.set(stats.exhausted)
    metrics.webhook_inbox_exhausted_last_hour.set(stats.exhausted_last_hour)
    metrics.webhook_inbox_oldest_pending_age_seconds.set(stats.oldest_pending_age_seconds)


async def watch_meta_inbox_metrics() -> None:
    """Ciclo aparte del que vacía el inbox: si ese se cuelga, este sigue
    midiendo y la edad del pendiente más viejo es justo lo que lo delata."""
    while True:
        try:
            await update_inbox_metrics()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("No se pudieron medir los eventos del inbox de Meta")
        await asyncio.sleep(METRICS_POLL_SECONDS)

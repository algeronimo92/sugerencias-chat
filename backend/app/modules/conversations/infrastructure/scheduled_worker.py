"""Worker de los mensajes programados: reclama los que llegaron a su hora y
los despacha con ``dispatch_scheduled_message``."""

from __future__ import annotations

import asyncio
import logging

from app.modules.conversations.application.ports import conversation_ports
from app.modules.conversations.application.scheduling import dispatch_scheduled_message
from app.tenancy.context import get_current_tenant

logger = logging.getLogger(__name__)

POLL_SECONDS = 1.0
DISPATCH_CONCURRENCY = 10


# Negocios a los que ya se les recuperaron los programados que quedaron a
# medio despachar por un reinicio.
_recovered: set[object] = set()


async def scheduled_tick() -> bool:
    """Una pasada para el negocio en curso: despacha lo que llegó a su hora.
    True si despachó algo, para que el ciclo vuelva sin esperar."""
    store = conversation_ports().scheduled
    context = get_current_tenant()
    key = context.organization_id if context else None
    if key not in _recovered:
        await store.recover_stale()
        _recovered.add(key)
    semaphore = asyncio.Semaphore(DISPATCH_CONCURRENCY)

    async def dispatch_bounded(scheduled_id: int) -> None:
        async with semaphore:
            try:
                await dispatch_scheduled_message(scheduled_id)
            except Exception:
                logger.exception("No se pudo despachar el mensaje programado %s", scheduled_id)

    due = await store.claim_due()
    if due:
        await asyncio.gather(*(dispatch_bounded(scheduled_id) for scheduled_id in due))
    return bool(due)


def forget_scheduled(key: object) -> None:
    """Si el negocio vuelve, se recuperan de nuevo los que quedaron a medias."""
    _recovered.discard(key)

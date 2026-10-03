"""Despertador del worker de automatizaciones.

Un trigger (un lead nuevo, un mensaje, un flujo reanudado) lo activa para que
el worker procese la cola de inmediato, sin bloquear la request HTTP que lo
originó: una acción puede tardar hasta 30 s esperando a Meta.
"""

from __future__ import annotations

import asyncio

_event = asyncio.Event()


def wake() -> None:
    _event.set()


async def sleep(timeout: float) -> None:
    """Duerme hasta el próximo ciclo o hasta que alguien llame a ``wake``."""
    try:
        await asyncio.wait_for(_event.wait(), timeout=timeout)
    except TimeoutError:
        pass
    _event.clear()

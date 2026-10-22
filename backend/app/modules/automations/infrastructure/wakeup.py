"""Despertador del worker de automatizaciones.

Un trigger (un lead nuevo, un mensaje, un flujo reanudado) lo hace sonar
para que el worker procese la cola de inmediato, sin bloquear la request
HTTP que lo originó: una acción puede tardar hasta 30 s esperando a Meta. Es
una señal del bus (``app.db.signals``): suena también en el proceso worker
aunque el trigger haya ocurrido en una réplica de la API.
"""

from __future__ import annotations

from app.db.signals import ring_soon, signal

AUTOMATIONS_SIGNAL = "automations"


def wake() -> None:
    ring_soon(AUTOMATIONS_SIGNAL)


async def sleep(timeout: float) -> None:
    """Duerme hasta el próximo ciclo o hasta que alguien llame a ``wake``."""
    await signal(AUTOMATIONS_SIGNAL).wait(timeout)

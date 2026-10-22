"""Proceso worker: ``python -m app.worker``.

Corre el trabajo de fondo (chats, automatizaciones, outbox, programados,
métricas y el inbox de Meta) fuera de la API, con el mismo cableado
(``app.composition``) y el mismo arranque (``app.runtime.prepare``). La API
se levanta con ``RUN_WORKERS=false`` y atiende solo HTTP, WebSocket y los
recordatorios de tareas, que dependen de sus conexiones.

Los avisos que emite el worker llegan a los navegadores por el bus de señales
(LISTEN/NOTIFY), y los despertadores que suenan en la API (un mensaje
encolado, un webhook de Meta) llegan al worker por el mismo bus.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import signal as os_signal

from app.core.logging_config import configure_logging

configure_logging()

from prometheus_client import start_http_server  # noqa: E402

from app.composition import configure as configure_composition  # noqa: E402
from app.core.config import settings  # noqa: E402
from app.runtime import prepare, start_background, stop_background  # noqa: E402

logger = logging.getLogger(__name__)


async def main() -> None:
    configure_composition()
    if settings.worker_metrics_port:
        # El worker no sirve HTTP: sus contadores (envíos, rechazos, colas)
        # se exponen aparte para que Prometheus los raspe.
        start_http_server(settings.worker_metrics_port)
    await prepare(maintenance=True)
    tasks = start_background(api=False, workers=True)
    stopping = asyncio.Event()
    loop = asyncio.get_running_loop()
    for signum in (os_signal.SIGTERM, os_signal.SIGINT):
        # En Windows no hay handlers de señales en el loop: ahí corta Ctrl+C.
        with contextlib.suppress(NotImplementedError):
            loop.add_signal_handler(signum, stopping.set)
    logger.info("Worker en marcha: %s", ", ".join(task.get_name() for task in tasks))
    try:
        await stopping.wait()
    finally:
        logger.info("Worker deteniéndose")
        await stop_background(tasks)


if __name__ == "__main__":
    asyncio.run(main())

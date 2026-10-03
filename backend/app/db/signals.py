"""Señales entre procesos sobre LISTEN/NOTIFY de PostgreSQL.

Con la API y los workers en procesos separados (y varias réplicas de la API),
un ``asyncio.Event`` ya no alcanza: el webhook de Meta entra por una réplica y
el worker que procesa el inbox corre en otro proceso; un aviso por WebSocket
se emite en el worker pero el navegador está conectado a una réplica de la API.

Una señal tiene un nombre y dos formas de reaccionar en cada proceso:

- ``wait``: un worker duerme hasta que suena o vence su sondeo de respaldo.
- ``on``: un handler recibe el payload (entregar por WebSocket, invalidar una
  caché).

``ring`` la hace sonar en el proceso local de inmediato y, si el bus está
activo (``start_bus``), la publica con ``pg_notify`` para los demás. Cada
proceso ignora sus propios mensajes al volver por LISTEN: ya los atendió.
Sin bus (tests, scripts) todo queda en el proceso, igual que antes.

NOTIFY admite hasta 8000 bytes de payload: los más grandes se comprimen y, si
aun así no entran, se atienden solo en el proceso local y se registra el
error.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import uuid
import zlib
from collections.abc import Awaitable, Callable
from typing import Any

logger = logging.getLogger(__name__)

CHANNEL = "app_signals"
MAX_NOTIFY_BYTES = 7500
PROCESS_ID = uuid.uuid4().hex

Handler = Callable[[dict], Awaitable[None]]


class Signal:
    def __init__(self, name: str) -> None:
        self.name = name
        self._event = asyncio.Event()
        self._handlers: list[Handler] = []

    def on(self, handler: Handler) -> Handler:
        if handler not in self._handlers:
            self._handlers.append(handler)
        return handler

    async def deliver(self, payload: dict) -> None:
        """Lo que pasa en este proceso cuando la señal suena (local o remota)."""
        self._event.set()
        for handler in self._handlers:
            try:
                await handler(payload)
            except Exception:
                logger.exception("Falló un handler de la señal %s", self.name)

    async def wait(self, timeout: float) -> None:
        """Duerme hasta que la señal suene o venza ``timeout``."""
        try:
            await asyncio.wait_for(self._event.wait(), timeout=timeout)
        except TimeoutError:
            pass
        finally:
            # Se limpia después de esperar: si sonó mientras se procesaba la
            # ronda anterior, perderlo devolvería el retardo que esto elimina.
            self._event.clear()


_signals: dict[str, Signal] = {}
_bus_running = False
_pending: set[asyncio.Task] = set()


def signal(name: str) -> Signal:
    if name not in _signals:
        _signals[name] = Signal(name)
    return _signals[name]


def _encode(name: str, payload: dict) -> str | None:
    body = json.dumps({"s": name, "o": PROCESS_ID, "p": payload}, separators=(",", ":"), default=str)
    if len(body.encode()) <= MAX_NOTIFY_BYTES:
        return body
    packed = base64.b64encode(zlib.compress(body.encode())).decode("ascii")
    compressed = json.dumps({"z": packed}, separators=(",", ":"))
    if len(compressed) <= MAX_NOTIFY_BYTES:
        return compressed
    logger.error("La señal %s pesa %s bytes: se atiende solo en este proceso", name, len(body))
    return None


def _decode(raw: str) -> tuple[str, str, dict]:
    message = json.loads(raw)
    if "z" in message:
        message = json.loads(zlib.decompress(base64.b64decode(message["z"])))
    return message["s"], message["o"], message.get("p") or {}


async def _notify(name: str, payload: dict) -> None:
    body = _encode(name, payload)
    if body is None:
        return
    from sqlalchemy import text

    from app.db.session import get_engine

    try:
        async with get_engine().connect() as connection:
            await connection.execute(text("SELECT pg_notify(:channel, :body)"), {"channel": CHANNEL, "body": body})
            await connection.commit()
    except Exception:
        logger.exception("No se pudo publicar la señal %s a los otros procesos", name)


async def ring(name: str, payload: dict | None = None) -> None:
    payload = payload or {}
    await signal(name).deliver(payload)
    if _bus_running:
        await _notify(name, payload)


async def ring_remote(name: str, payload: dict | None = None) -> None:
    """Solo para los otros procesos: lo local ya lo atendió quien llama (p. ej.
    el WebSocket entrega a sus conexiones y necesita saber si llegó)."""
    if _bus_running:
        await _notify(name, payload or {})


def tell_others_soon(name: str, payload: dict | None = None) -> None:
    """``ring_remote`` desde código síncrono (una invalidación de caché que ya
    se aplicó en este proceso). Sin bus o sin loop no hace nada."""
    if not _bus_running:
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    task = loop.create_task(_notify(name, payload or {}))
    _pending.add(task)
    task.add_done_callback(_pending.discard)


def ring_soon(name: str, payload: dict | None = None) -> None:
    """``ring`` desde código síncrono: lo programa en el loop en curso."""
    task = asyncio.get_running_loop().create_task(ring(name, payload))
    _pending.add(task)
    task.add_done_callback(_pending.discard)


async def _on_notification(_connection: Any, _pid: int, _channel: str, raw: str) -> None:
    try:
        name, origin, payload = _decode(raw)
    except Exception:
        logger.exception("Señal ilegible en %s", CHANNEL)
        return
    if origin == PROCESS_ID:
        return
    await signal(name).deliver(payload)


async def run_bus(reconnect_seconds: float = 5.0) -> None:
    """Escucha el canal mientras el proceso vive; reconecta si se corta."""
    import asyncpg

    from app.db.session import asyncpg_connect_kwargs

    global _bus_running
    _bus_running = True
    try:
        while True:
            connection = None
            try:
                connection = await asyncpg.connect(**asyncpg_connect_kwargs())

                def listener(conn, pid, channel, raw):
                    task = asyncio.get_running_loop().create_task(_on_notification(conn, pid, channel, raw))
                    _pending.add(task)
                    task.add_done_callback(_pending.discard)

                await connection.add_listener(CHANNEL, listener)
                logger.info("Bus de señales escuchando %s", CHANNEL)
                while not connection.is_closed():
                    await asyncio.sleep(reconnect_seconds)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("El bus de señales perdió la conexión; reintentando")
            finally:
                if connection is not None and not connection.is_closed():
                    await connection.close()
            await asyncio.sleep(reconnect_seconds)
    finally:
        _bus_running = False

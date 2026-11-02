"""El bus de señales contra PostgreSQL real: lo que publica un proceso lo
escucha otro."""

import asyncio
from uuid import uuid4

from app.db import signals
from tests.postgres_fixtures import app_engine, pg_dsn  # noqa: F401


async def test_a_notification_from_another_process_is_delivered(app_engine, monkeypatch):
    received = asyncio.Event()
    name = f"test-{uuid4().hex}"
    payloads = []

    @signals.signal(name).on
    async def handler(payload):
        payloads.append(payload)
        received.set()

    bus = asyncio.create_task(signals.run_bus(reconnect_seconds=0.2))
    try:
        await asyncio.sleep(1.0)  # que el LISTEN quede tomado
        # Otro proceso: mismo canal y misma clave, distinto origen.
        own_id = signals.PROCESS_ID
        monkeypatch.setattr(signals, "PROCESS_ID", "otro-proceso")
        token = signals._encode(name, {"chat_id": "lead-1"})
        monkeypatch.setattr(signals, "PROCESS_ID", own_id)
        monkeypatch.setattr(signals, "_encode", lambda _name, _payload: token)
        await signals._notify(name, {"chat_id": "lead-1"})
        await asyncio.wait_for(received.wait(), timeout=5)
    finally:
        bus.cancel()
        try:
            await bus
        except asyncio.CancelledError:
            pass

    assert payloads == [{"chat_id": "lead-1"}]


async def test_a_deaf_connection_is_replaced(app_engine, monkeypatch):
    """Si la consulta de control falla, el bus reconecta y rehace lo que pudo
    haberse perdido."""
    import asyncpg

    connects = []
    resyncs = []
    real_connect = asyncpg.connect

    class Deaf:
        """La conexión sigue abierta pero ya no responde."""

        def __init__(self, connection):
            self._connection = connection

        def __getattr__(self, name):
            return getattr(self._connection, name)

        async def fetchval(self, *_args, **_kwargs):
            raise ConnectionError("sin respuesta")

    async def counting_connect(**kwargs):
        connection = await real_connect(**kwargs)
        connects.append(connection)
        return Deaf(connection) if len(connects) == 1 else connection

    async def resync():
        resyncs.append(True)

    monkeypatch.setattr(asyncpg, "connect", counting_connect)
    monkeypatch.setattr(signals, "_resync", resync)
    bus = asyncio.create_task(signals.run_bus(reconnect_seconds=0.05, keepalive_seconds=0.1))
    try:
        async with asyncio.timeout(5):
            while not resyncs:
                await asyncio.sleep(0.05)
    finally:
        bus.cancel()
        try:
            await bus
        except asyncio.CancelledError:
            pass

    assert len(connects) >= 2

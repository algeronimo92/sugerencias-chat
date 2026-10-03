"""El bus de señales contra PostgreSQL real: lo que publica un proceso lo
escucha otro."""

import asyncio
import json
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
        # Otro proceso: mismo canal, distinto origen.
        monkeypatch.setattr(signals, "_encode", lambda signal_name, payload: json.dumps(
            {"s": signal_name, "o": "otro-proceso", "p": payload},
        ))
        await signals._notify(name, {"chat_id": "lead-1"})
        await asyncio.wait_for(received.wait(), timeout=5)
    finally:
        bus.cancel()
        try:
            await bus
        except asyncio.CancelledError:
            pass

    assert payloads == [{"chat_id": "lead-1"}]

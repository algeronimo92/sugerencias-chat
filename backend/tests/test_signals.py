"""El bus de señales: despertadores, avisos y cachés entre procesos."""

import asyncio
import base64
import os
from unittest.mock import AsyncMock
from uuid import uuid4

from app.db import signals
from app.realtime import ws_manager


async def test_a_ring_wakes_a_waiting_worker_in_this_process() -> None:
    bell = signals.signal(f"test-{uuid4().hex}")
    waiter = asyncio.create_task(bell.wait(timeout=5))
    await asyncio.sleep(0)

    await signals.ring(bell.name)

    await asyncio.wait_for(waiter, timeout=1)


async def test_handlers_receive_the_payload() -> None:
    received = []
    name = f"test-{uuid4().hex}"

    @signals.signal(name).on
    async def handler(payload):
        received.append(payload)

    await signals.ring(name, {"user_id": 7})

    assert received == [{"user_id": 7}]


def test_large_payloads_travel_compressed() -> None:
    payload = {"message": {"text": "hola " * 4000}}
    encoded = signals._encode("realtime", payload)

    assert encoded is not None and len(encoded) <= signals.MAX_NOTIFY_BYTES
    assert signals._decode(encoded) == ("realtime", signals.PROCESS_ID, payload)


def test_what_does_not_fit_stays_in_this_process() -> None:
    random_text = base64.b64encode(os.urandom(12000)).decode()  # no se comprime
    assert signals._encode("realtime", {"blob": random_text}) is None


async def test_a_process_ignores_its_own_notifications() -> None:
    received = []
    name = f"test-{uuid4().hex}"
    signals.signal(name).on(AsyncMock(side_effect=lambda payload: received.append(payload)))

    await signals._on_notification(None, 0, signals.CHANNEL, signals._encode(name, {"x": 1}))

    assert received == []


async def test_what_another_replica_emitted_reaches_local_sockets(monkeypatch) -> None:
    """Un aviso emitido por el worker llega a la pestaña conectada a esta
    réplica."""
    organization_id = uuid4()
    class Socket:
        send_json = AsyncMock()

    socket = Socket()
    manager = ws_manager.ConnectionManager()
    manager._connections[socket] = ws_manager.SocketOwner(7, organization_id)
    monkeypatch.setattr(ws_manager, "manager", manager)

    await ws_manager._from_other_process({
        "kind": "user", "organization_id": str(organization_id), "user_id": 7,
        "message": {"type": "notification_created"},
    })
    await ws_manager._from_other_process({
        "kind": "broadcast", "organization_id": str(uuid4()), "message": {"type": "tasks_updated"},
    })

    socket.send_json.assert_awaited_once_with({"type": "notification_created"})


async def test_presence_bound_delivery_does_not_leave_the_process(monkeypatch) -> None:
    remote = AsyncMock()
    monkeypatch.setattr(signals, "ring_remote", remote)
    manager = ws_manager.ConnectionManager()

    delivered = await manager.send_to_user_here(7, {"type": "task_reminder"}, organization_id=uuid4())

    assert delivered is False
    remote.assert_not_awaited()

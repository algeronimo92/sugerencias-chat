"""bcrypt es lento a propósito: si corre en el event loop, cada login congela
toda la API (WebSockets y /health/ready incluidos) mientras dura."""

import asyncio
import time

from app.modules.auth import auth_service


async def _ticks_while(awaitable) -> tuple[object, int]:
    ticks = 0

    async def ticker() -> None:
        nonlocal ticks
        while True:
            await asyncio.sleep(0.01)
            ticks += 1

    task = asyncio.create_task(ticker())
    try:
        result = await awaitable
    finally:
        task.cancel()
    return result, ticks


async def test_password_check_leaves_the_event_loop_free(monkeypatch) -> None:
    def slow_checkpw(*_args) -> bool:
        time.sleep(0.3)
        return True

    monkeypatch.setattr(auth_service.bcrypt, "checkpw", slow_checkpw)
    valid, ticks = await _ticks_while(auth_service.verify_password_async("clave", "hash"))
    assert valid is True
    assert ticks >= 10


async def test_password_hash_leaves_the_event_loop_free(monkeypatch) -> None:
    def slow_hashpw(*_args) -> bytes:
        time.sleep(0.3)
        return b"hash"

    monkeypatch.setattr(auth_service.bcrypt, "hashpw", slow_hashpw)
    hashed, ticks = await _ticks_while(auth_service.hash_password_async("clave"))
    assert hashed == "hash"
    assert ticks >= 10

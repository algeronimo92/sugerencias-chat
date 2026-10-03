"""El mantenimiento de arranque contra PostgreSQL real: dos procesos que
arrancan a la vez no lo corren en paralelo."""

import asyncio

from app import runtime
from tests.postgres_fixtures import app_engine, pg_dsn  # noqa: F401


async def test_two_processes_take_turns_on_maintenance(app_engine, monkeypatch):
    inside = 0
    overlaps = []

    async def normalize():
        nonlocal inside
        inside += 1
        overlaps.append(inside)
        await asyncio.sleep(0.2)
        inside -= 1

    monkeypatch.setattr(runtime, "_normalize_settings", normalize)
    monkeypatch.setattr(runtime.settings, "admin_email", "")

    await asyncio.gather(runtime._maintain(), runtime._maintain())

    assert overlaps == [1, 1]

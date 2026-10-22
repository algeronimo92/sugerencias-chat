from unittest.mock import AsyncMock

import pytest

from app.modules.leads import assignment
from app.modules.leads.assignment import pick_next_vendedor_id
from tests.conftest import patch_session_scope


@pytest.mark.asyncio
async def test_pick_next_vendedor_id_returns_query_result(monkeypatch):
    session = AsyncMock()
    session.scalar = AsyncMock(return_value=7)

    _serve(monkeypatch, session)
    result = await pick_next_vendedor_id()

    assert result == 7
    session.scalar.assert_awaited_once()


@pytest.mark.asyncio
async def test_pick_next_vendedor_id_returns_none_without_active_vendedores(monkeypatch):
    session = AsyncMock()
    session.scalar = AsyncMock(return_value=None)

    _serve(monkeypatch, session)
    assert await pick_next_vendedor_id() is None


def _serve(monkeypatch, session):
    class Opened:
        async def __aenter__(self):
            return session

        async def __aexit__(self, *_exc):
            return False

    patch_session_scope(monkeypatch, assignment, lambda: Opened)

from unittest.mock import AsyncMock

import pytest

from services.lead_assignment import pick_next_vendedor_id


@pytest.mark.asyncio
async def test_pick_next_vendedor_id_returns_query_result():
    session = AsyncMock()
    session.scalar = AsyncMock(return_value=7)

    result = await pick_next_vendedor_id(session)

    assert result == 7
    session.scalar.assert_awaited_once()


@pytest.mark.asyncio
async def test_pick_next_vendedor_id_returns_none_without_active_vendedores():
    session = AsyncMock()
    session.scalar = AsyncMock(return_value=None)

    assert await pick_next_vendedor_id(session) is None

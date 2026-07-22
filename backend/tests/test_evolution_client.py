from unittest.mock import AsyncMock

import pytest

from services import evolution_service


@pytest.mark.asyncio
async def test_config_loads_all_evolution_values_together(monkeypatch):
    load_values = AsyncMock(return_value={
        "evolution_api_url": "https://evolution.test",
        "evolution_api_key": "secret",
        "evolution_instance": "dermica",
    })
    monkeypatch.setattr(evolution_service, "get_effective_many", load_values)

    assert await evolution_service._config() == (
        "https://evolution.test", "secret", "dermica",
    )
    load_values.assert_awaited_once_with((
        "evolution_api_url",
        "evolution_api_key",
        "evolution_instance",
    ))


@pytest.mark.asyncio
async def test_http_client_is_reused_and_closed(monkeypatch):
    client = AsyncMock()
    client.is_closed = False
    factory = lambda **_kwargs: client
    monkeypatch.setattr(evolution_service.httpx, "AsyncClient", factory)
    evolution_service._http_client = None

    assert evolution_service._client() is client
    assert evolution_service._client() is client

    await evolution_service.close_evolution_client()
    client.aclose.assert_awaited_once_with()
    assert evolution_service._http_client is None

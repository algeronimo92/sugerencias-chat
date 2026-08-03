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
async def test_check_whatsapp_numbers_posts_to_chat_endpoint(monkeypatch):
    monkeypatch.setattr(
        evolution_service,
        "_config",
        AsyncMock(return_value=("https://evolution.test/", "secret", "dermica")),
    )
    post = AsyncMock(return_value=[{"exists": True, "jid": "51906471403@s.whatsapp.net"}])
    monkeypatch.setattr(evolution_service, "_post", post)

    result = await evolution_service.check_whatsapp_numbers(["51906471403"])

    assert result == [{"exists": True, "jid": "51906471403@s.whatsapp.net"}]
    post.assert_awaited_once_with(
        "https://evolution.test/chat/whatsappNumbers/dermica",
        "secret",
        {"numbers": ["51906471403"]},
        timeout=10.0,
    )


@pytest.mark.asyncio
async def test_check_whatsapp_numbers_tolerates_non_list_response(monkeypatch):
    monkeypatch.setattr(
        evolution_service,
        "_config",
        AsyncMock(return_value=("https://evolution.test", "secret", "dermica")),
    )
    monkeypatch.setattr(evolution_service, "_post", AsyncMock(return_value={"status": "ok"}))

    assert await evolution_service.check_whatsapp_numbers(["51906471403"]) == []


@pytest.mark.asyncio
async def test_find_phone_jid_for_lid_uses_contact_number(monkeypatch):
    monkeypatch.setattr(
        evolution_service,
        "_config",
        AsyncMock(return_value=("https://evolution.test/", "secret", "dermica")),
    )
    post = AsyncMock(return_value=[{
        "id": "267692862898397@lid",
        "number": "51943663225",
    }])
    monkeypatch.setattr(evolution_service, "_post", post)

    result = await evolution_service.find_phone_jid_for_lid("267692862898397@lid")

    assert result == "51943663225@s.whatsapp.net"
    post.assert_awaited_once_with(
        "https://evolution.test/chat/findContacts/dermica",
        "secret",
        {"where": {"id": "267692862898397@lid"}, "take": 5},
        timeout=10.0,
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("number", ["267692862898397", "267692862898397@lid"])
async def test_find_phone_jid_for_lid_never_treats_lid_digits_as_phone(
    monkeypatch, number,
):
    monkeypatch.setattr(
        evolution_service,
        "_config",
        AsyncMock(return_value=("https://evolution.test", "secret", "dermica")),
    )
    monkeypatch.setattr(
        evolution_service,
        "_post",
        AsyncMock(return_value=[{"id": "267692862898397@lid", "number": number}]),
    )

    assert await evolution_service.find_phone_jid_for_lid("267692862898397@lid") is None


@pytest.mark.asyncio
async def test_find_chat_messages_consulta_el_historial_del_chat(monkeypatch):
    monkeypatch.setattr(
        evolution_service,
        "_config",
        AsyncMock(return_value=("https://evolution.test/", "secret", "dermica")),
    )
    post = AsyncMock(return_value={"messages": {"records": []}})
    monkeypatch.setattr(evolution_service, "_post", post)

    await evolution_service.find_chat_messages("51906471403@s.whatsapp.net", 3)

    post.assert_awaited_once_with(
        "https://evolution.test/chat/findMessages/dermica",
        "secret",
        {
            "where": {"key": {"remoteJid": "51906471403@s.whatsapp.net"}},
            "page": 3,
            "offset": 50,
        },
        timeout=30.0,
    )


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

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
    # Se filtra por remoteJid: el `id` de un contacto es una clave interna de
    # Evolution (un cuid), así que filtrar por ahí no devuelve nada nunca.
    post.assert_awaited_once_with(
        "https://evolution.test/chat/findContacts/dermica",
        "secret",
        {"where": {"remoteJid": "267692862898397@lid"}, "take": 5},
        timeout=10.0,
    )


@pytest.mark.asyncio
async def test_find_phone_jid_for_lid_gives_up_on_a_contact_without_a_number(
    monkeypatch,
):
    """Forma real de un contacto @lid en Evolution 2.3.7: no trae teléfono.

    Ahí el lead nace sin número y la equivalencia solo aparece después, en la
    respuesta de un envío (learn_send_aliases).
    """
    monkeypatch.setattr(
        evolution_service,
        "_config",
        AsyncMock(return_value=("https://evolution.test", "secret", "dermica")),
    )
    monkeypatch.setattr(
        evolution_service,
        "_post",
        AsyncMock(return_value=[{
            "id": "cmsrnuel205dumn54rorvb8c9",
            "remoteJid": "267692862898397@lid",
            "pushName": "Dani 🌷",
            "profilePicUrl": None,
        }]),
    )

    assert await evolution_service.find_phone_jid_for_lid("267692862898397@lid") is None


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
    lead_id = "7b08f4d9-855f-4718-b95f-9c021da52f77"
    destination = "51906471403@s.whatsapp.net"
    monkeypatch.setattr(
        evolution_service,
        "_config",
        AsyncMock(return_value=("https://evolution.test/", "secret", "dermica")),
    )
    post = AsyncMock(return_value={"messages": {"records": []}})
    monkeypatch.setattr(evolution_service, "_post", post)
    # El historial se pide por el JID que Evolution indexa, no por el de envío.
    monkeypatch.setattr(
        evolution_service,
        "resolve_history_jid",
        AsyncMock(return_value=destination),
    )

    await evolution_service.find_chat_messages(lead_id, 3)

    post.assert_awaited_once_with(
        "https://evolution.test/chat/findMessages/dermica",
        "secret",
        {
            "where": {"key": {"remoteJid": destination}},
            "page": 3,
            "offset": 50,
        },
        timeout=30.0,
    )


@pytest.mark.asyncio
async def test_send_text_replaces_uuid_in_quoted_key_with_destination(monkeypatch):
    lead_id = "7b08f4d9-855f-4718-b95f-9c021da52f77"
    destination = "51906471403@s.whatsapp.net"
    monkeypatch.setattr(
        evolution_service,
        "_config",
        AsyncMock(return_value=("https://evolution.test", "secret", "dermica")),
    )
    post = AsyncMock(return_value={"ok": True})
    monkeypatch.setattr(evolution_service, "_post", post)
    monkeypatch.setattr(
        evolution_service,
        "resolve_whatsapp_destination",
        AsyncMock(return_value=destination),
    )
    quoted = {
        "key": {"remoteJid": lead_id, "fromMe": False, "id": "WA-1"},
        "message": {"conversation": "hola"},
    }

    await evolution_service.send_whatsapp_text(lead_id, "respuesta", quoted=quoted)

    payload = post.await_args.args[2]
    assert payload["number"] == destination
    assert payload["quoted"]["key"]["remoteJid"] == destination


@pytest.mark.asyncio
async def test_send_text_raises_window_closed_when_meta_rejects_with_131047(monkeypatch):
    # Evolution, en modo WHATSAPP-BUSINESS, atrapa el error de axios cuando
    # Meta rechaza el POST a /messages y devuelve el objeto de error de Meta
    # tal cual, con el mismo HTTP 200/201 que un envío real (confirmado
    # leyendo whatsapp.business.service.ts: post() nunca relanza el error).
    # Sin la validación de forma, esto pasaría como un envío exitoso.
    lead_id = "7b08f4d9-855f-4718-b95f-9c021da52f77"
    monkeypatch.setattr(
        evolution_service,
        "_config",
        AsyncMock(return_value=("https://evolution.test", "secret", "dermica")),
    )
    monkeypatch.setattr(evolution_service, "_post", AsyncMock(return_value={
        "message": "(#131047) Message failed to send because more than 24 hours "
                   "have passed since the customer last replied to this number.",
        "type": "OAuthException",
        "code": 131047,
    }))
    monkeypatch.setattr(
        evolution_service, "resolve_whatsapp_destination",
        AsyncMock(return_value="51906471403@s.whatsapp.net"),
    )

    with pytest.raises(evolution_service.WhatsAppWindowClosedError):
        await evolution_service.send_whatsapp_text(lead_id, "hola")


@pytest.mark.asyncio
async def test_send_text_raises_generic_error_for_other_meta_rejections(monkeypatch):
    lead_id = "7b08f4d9-855f-4718-b95f-9c021da52f77"
    monkeypatch.setattr(
        evolution_service,
        "_config",
        AsyncMock(return_value=("https://evolution.test", "secret", "dermica")),
    )
    monkeypatch.setattr(evolution_service, "_post", AsyncMock(return_value={
        "message": "Invalid parameter",
        "type": "OAuthException",
        "code": 100,
    }))
    monkeypatch.setattr(
        evolution_service, "resolve_whatsapp_destination",
        AsyncMock(return_value="51906471403@s.whatsapp.net"),
    )

    with pytest.raises(evolution_service.EvolutionApiError) as excinfo:
        await evolution_service.send_whatsapp_text(lead_id, "hola")
    assert not isinstance(excinfo.value, evolution_service.WhatsAppWindowClosedError)
    assert "Invalid parameter" in str(excinfo.value)


@pytest.mark.asyncio
async def test_send_text_accepts_a_real_send_response(monkeypatch):
    """Regresión: la validación de forma no debe rechazar un envío real."""
    lead_id = "7b08f4d9-855f-4718-b95f-9c021da52f77"
    monkeypatch.setattr(
        evolution_service,
        "_config",
        AsyncMock(return_value=("https://evolution.test", "secret", "dermica")),
    )
    monkeypatch.setattr(evolution_service, "_post", AsyncMock(return_value={
        "key": {"id": "WA-OK", "remoteJid": "51906471403@s.whatsapp.net", "fromMe": True},
        "message": {"conversation": "hola"},
        "messageTimestamp": 1234567890,
        "status": "PENDING",
    }))
    monkeypatch.setattr(
        evolution_service, "resolve_whatsapp_destination",
        AsyncMock(return_value="51906471403@s.whatsapp.net"),
    )

    result = await evolution_service.send_whatsapp_text(lead_id, "hola")
    assert result["key"]["id"] == "WA-OK"


class _FakeInstancesResponse:
    def __init__(self, rows):
        self.is_error = False
        self._rows = rows

    def json(self):
        return self._rows


class _FakeHttpClient:
    def __init__(self, rows):
        self._rows = rows

    async def get(self, url, headers=None, timeout=None):
        return _FakeInstancesResponse(self._rows)


def _mock_fetch_instances(monkeypatch, rows):
    evolution_service._capabilities_cache = None
    monkeypatch.setattr(
        evolution_service, "_config",
        AsyncMock(return_value=("https://evolution.test", "secret", "dermica")),
    )
    monkeypatch.setattr(evolution_service, "_client", lambda: _FakeHttpClient(rows))


@pytest.mark.asyncio
async def test_instance_capabilities_business_allows_templates_but_not_baileys_only_features(monkeypatch):
    _mock_fetch_instances(monkeypatch, [{"name": "dermica", "integration": "WHATSAPP-BUSINESS"}])

    result = await evolution_service.get_instance_capabilities()

    assert result == {
        "integration": "WHATSAPP-BUSINESS",
        "official_sending_supported": True,
        "history_available": False,
        "edit_delete_supported": False,
        "reason": None,
    }


@pytest.mark.asyncio
async def test_instance_capabilities_baileys_allows_the_opposite_of_business(monkeypatch):
    _mock_fetch_instances(monkeypatch, [{"name": "dermica", "integration": "WHATSAPP-BAILEYS"}])

    result = await evolution_service.get_instance_capabilities()

    assert result["official_sending_supported"] is False
    assert result["history_available"] is True
    assert result["edit_delete_supported"] is True
    assert result["reason"] is not None


@pytest.mark.asyncio
async def test_instance_capabilities_are_restrictive_when_integration_is_unknown(monkeypatch):
    # La instancia configurada no aparece en fetchInstances (typo, instancia
    # borrada, etc.). Sin poder confirmar qué es, se restringe todo por
    # igual -mismo criterio que ya usaba official_sending_supported- en vez
    # de asumir que es "todo menos Business" y arriesgarse a ofrecer una
    # función que en los hechos sí es Business y va a fallar al usarla.
    _mock_fetch_instances(monkeypatch, [{"name": "otra-instancia", "integration": "WHATSAPP-BUSINESS"}])

    result = await evolution_service.get_instance_capabilities()

    assert result["integration"] is None
    assert result["official_sending_supported"] is False
    assert result["history_available"] is False
    assert result["edit_delete_supported"] is False


@pytest.mark.asyncio
async def test_send_reaction_resolves_uuid_to_destination(monkeypatch):
    lead_id = "7b08f4d9-855f-4718-b95f-9c021da52f77"
    destination = "51906471403@s.whatsapp.net"
    monkeypatch.setattr(
        evolution_service,
        "_config",
        AsyncMock(return_value=("https://evolution.test", "secret", "dermica")),
    )
    post = AsyncMock(return_value={"ok": True})
    monkeypatch.setattr(evolution_service, "_post", post)
    resolve = AsyncMock(return_value=destination)
    monkeypatch.setattr(evolution_service, "resolve_whatsapp_destination", resolve)

    await evolution_service.send_whatsapp_reaction(
        {"remoteJid": lead_id, "fromMe": False, "id": "WA-1"}, "❤️"
    )

    resolve.assert_awaited_once_with(lead_id)
    assert post.await_args.args[2]["key"]["remoteJid"] == destination


@pytest.mark.asyncio
async def test_edit_message_builds_own_key_on_resolved_destination(monkeypatch):
    lead_id = "7b08f4d9-855f-4718-b95f-9c021da52f77"
    destination = "51906471403@s.whatsapp.net"
    monkeypatch.setattr(
        evolution_service,
        "_config",
        AsyncMock(return_value=("https://evolution.test", "secret", "dermica")),
    )
    post = AsyncMock(return_value={"ok": True})
    monkeypatch.setattr(evolution_service, "_post", post)
    monkeypatch.setattr(
        evolution_service, "resolve_whatsapp_destination", AsyncMock(return_value=destination)
    )

    await evolution_service.edit_whatsapp_message(lead_id, "WA-1", "corregido")

    url, _api_key, payload = post.await_args.args[:3]
    assert url == "https://evolution.test/chat/updateMessage/dermica"
    assert payload == {
        "number": destination,
        "text": "corregido",
        "key": {"remoteJid": destination, "fromMe": True, "id": "WA-1"},
    }


@pytest.mark.asyncio
async def test_delete_message_uses_delete_with_flat_key(monkeypatch):
    lead_id = "7b08f4d9-855f-4718-b95f-9c021da52f77"
    destination = "51906471403@s.whatsapp.net"
    monkeypatch.setattr(
        evolution_service,
        "_config",
        AsyncMock(return_value=("https://evolution.test", "secret", "dermica")),
    )
    request = AsyncMock(return_value={"ok": True})
    monkeypatch.setattr(evolution_service, "_request", request)
    monkeypatch.setattr(
        evolution_service, "resolve_whatsapp_destination", AsyncMock(return_value=destination)
    )

    await evolution_service.delete_whatsapp_message(lead_id, "WA-1")

    method, url, _api_key, payload = request.await_args.args[:4]
    assert method == "DELETE"
    assert url == "https://evolution.test/chat/deleteMessageForEveryone/dermica"
    # La key va desarmada, no anidada bajo `key` como en sendReaction.
    assert payload == {"id": "WA-1", "fromMe": True, "remoteJid": destination}


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

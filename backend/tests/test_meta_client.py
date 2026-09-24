from unittest.mock import AsyncMock

import pytest

from services import meta_service
from services.message_media import mediatype_from_content_type
from services.whatsapp_identity_service import Destination
from services.whatsapp_channel import describe_send_failure


@pytest.mark.asyncio
async def test_config_loads_all_meta_values_together(monkeypatch):
    load_values = AsyncMock(return_value={
        "meta_access_token": "token-123",
        "meta_phone_number_id": "PHONE1",
        "meta_waba_id": "WABA1",
    })
    monkeypatch.setattr(meta_service, "get_effective_many", load_values)

    assert await meta_service._config() == ("token-123", "PHONE1", "WABA1")
    load_values.assert_awaited_once_with((
        "meta_access_token", "meta_phone_number_id", "meta_waba_id",
    ))


@pytest.mark.asyncio
async def test_config_fails_loudly_when_any_value_missing(monkeypatch):
    monkeypatch.setattr(meta_service, "get_effective_many", AsyncMock(return_value={
        "meta_access_token": "token-123",
        "meta_phone_number_id": "",
        "meta_waba_id": "WABA1",
    }))

    with pytest.raises(meta_service.MetaApiError):
        await meta_service._config()


@pytest.mark.asyncio
async def test_is_configured_true_only_when_all_three_present(monkeypatch):
    monkeypatch.setattr(meta_service, "get_effective_many", AsyncMock(return_value={
        "meta_access_token": "token-123",
        "meta_phone_number_id": "PHONE1",
        "meta_waba_id": "WABA1",
    }))
    assert await meta_service.is_configured() is True

    monkeypatch.setattr(meta_service, "get_effective_many", AsyncMock(return_value={
        "meta_access_token": "",
        "meta_phone_number_id": "PHONE1",
        "meta_waba_id": "WABA1",
    }))
    assert await meta_service.is_configured() is False


class _FakeGraphResponse:
    def __init__(self, payload, is_error=False, status_code=200, text=""):
        self._payload = payload
        self.is_error = is_error
        self.status_code = status_code
        self.text = text or str(payload)

    def json(self):
        return self._payload


class _FakeGraphClient:
    def __init__(self, responses):
        self._responses = list(responses)
        self.calls: list[dict] = []

    async def request(self, method, url, **kwargs):
        self.calls.append({"method": method, "url": url, **kwargs})
        return self._responses.pop(0)

    async def get(self, url, **kwargs):
        return await self.request("GET", url, **kwargs)

    async def post(self, url, **kwargs):
        return await self.request("POST", url, **kwargs)


def _mock_config(monkeypatch, token="token-123", phone_number_id="PHONE1", waba_id="WABA1"):
    monkeypatch.setattr(meta_service, "_config", AsyncMock(return_value=(token, phone_number_id, waba_id)))


@pytest.mark.asyncio
async def test_embedded_signup_combines_platform_app_with_tenant_connection(monkeypatch):
    platform_values = AsyncMock(return_value={
        "meta_app_id": "CLINIVENTAS_APP",
        "meta_app_secret": "platform-secret",
    })
    tenant_update = AsyncMock()
    fake_client = _FakeGraphClient([
        _FakeGraphResponse({"access_token": "tenant-access-token"}),
        _FakeGraphResponse({"success": True}),
    ])
    monkeypatch.setattr(meta_service, "platform_settings_many", platform_values)
    monkeypatch.setattr(meta_service, "update_settings", tenant_update)
    monkeypatch.setattr(meta_service, "get_current_tenant", lambda: None)
    monkeypatch.setattr(meta_service, "_client", lambda: fake_client)

    await meta_service.complete_embedded_signup("one-time-code", "DERMICA_WABA", "DERMICA_PHONE")

    assert fake_client.calls[0]["params"] == {
        "client_id": "CLINIVENTAS_APP",
        "client_secret": "platform-secret",
        "code": "one-time-code",
    }
    assert fake_client.calls[1]["url"].endswith("/DERMICA_WABA/subscribed_apps")
    tenant_update.assert_awaited_once_with({
        "meta_access_token": "tenant-access-token",
        "meta_waba_id": "DERMICA_WABA",
        "meta_phone_number_id": "DERMICA_PHONE",
    })


@pytest.mark.asyncio
async def test_send_message_adds_the_envelope_with_the_exact_wa_id(monkeypatch):
    _mock_config(monkeypatch)
    monkeypatch.setattr(
        meta_service, "resolve_whatsapp_destination",
        AsyncMock(return_value=Destination(wa_id="51906471403", user_id="PE.1")),
    )
    fake_client = _FakeGraphClient([
        _FakeGraphResponse({
            "messages": [{"id": "wamid.XYZ"}],
            "contacts": [{"input": "51906471403", "wa_id": "51906471403"}],
        }),
    ])
    monkeypatch.setattr(meta_service, "_client", lambda: fake_client)
    message = {"type": "text", "text": {"body": "hola"}, "context": {"message_id": "wamid.ORIGINAL"}}

    result = await meta_service.send_message("lead-1", message)

    body = fake_client.calls[0]["json"]
    assert body == {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": "51906471403",
        **message,
    }
    assert result["body"] == body
    assert result["response"]["messages"][0]["id"] == "wamid.XYZ"


@pytest.mark.asyncio
async def test_send_to_a_user_id_only_lead_fails_explicitly(monkeypatch):
    """Un contacto que solo se conoce por su user_id no tiene número al que
    este envío pueda apuntar: falla claro, no con un error genérico."""
    _mock_config(monkeypatch)
    monkeypatch.setattr(
        meta_service, "resolve_whatsapp_destination",
        AsyncMock(return_value=Destination(wa_id=None, user_id="PE.1084026510784249")),
    )

    with pytest.raises(meta_service.MetaApiError, match="user_id"):
        await meta_service.send_message("lead-1", {"type": "text", "text": {"body": "hola"}})


@pytest.mark.asyncio
async def test_raise_meta_error_classifies_window_closed(monkeypatch):
    _mock_config(monkeypatch)
    monkeypatch.setattr(
        meta_service, "resolve_whatsapp_destination",
        AsyncMock(return_value=Destination(wa_id="51906471403", user_id=None)),
    )
    fake_client = _FakeGraphClient([
        _FakeGraphResponse(
            {"error": {
                "message": "(#131047) Message failed to send because more than 24 hours "
                           "have passed since the customer last replied to this number.",
                "type": "OAuthException", "code": 131047,
            }},
            is_error=True, status_code=400,
        ),
    ])
    monkeypatch.setattr(meta_service, "_client", lambda: fake_client)

    with pytest.raises(meta_service.WhatsAppWindowClosedError):
        await meta_service.send_message("lead-1", {"type": "text", "text": {"body": "hola"}})


@pytest.mark.asyncio
async def test_raise_meta_error_generic_for_other_codes(monkeypatch):
    _mock_config(monkeypatch)
    monkeypatch.setattr(
        meta_service, "resolve_whatsapp_destination",
        AsyncMock(return_value=Destination(wa_id="51906471403", user_id=None)),
    )
    fake_client = _FakeGraphClient([
        _FakeGraphResponse(
            {"error": {"message": "Invalid parameter", "type": "OAuthException", "code": 100}},
            is_error=True, status_code=400,
        ),
    ])
    monkeypatch.setattr(meta_service, "_client", lambda: fake_client)

    with pytest.raises(meta_service.MetaApiError) as excinfo:
        await meta_service.send_message("lead-1", {"type": "text", "text": {"body": "hola"}})
    assert not isinstance(excinfo.value, meta_service.WhatsAppWindowClosedError)
    assert "Invalid parameter" in str(excinfo.value)
    assert excinfo.value.error["code"] == 100


def test_describe_send_failure_keeps_window_closed_message_verbatim():
    exc = meta_service.WhatsAppWindowClosedError("ventana cerrada, mandá una plantilla")
    assert describe_send_failure(exc, "enviar el mensaje") == "ventana cerrada, mandá una plantilla"


def test_describe_send_failure_hides_generic_errors_behind_friendly_text():
    exc = meta_service.MetaApiError("Meta Graph API respondió 400: ...")
    assert describe_send_failure(exc, "enviar el mensaje") == \
        "No se pudo enviar el mensaje. Probá de nuevo en unos segundos."


def test_describe_template_error_prefers_error_user_msg():
    exc = meta_service.MetaApiError("boom", error={
        "message": "generic", "error_user_msg": "El nombre de la plantilla ya existe",
    })
    assert meta_service.describe_template_error(exc) == "El nombre de la plantilla ya existe"


def test_describe_template_error_falls_back_to_error_data_details():
    exc = meta_service.MetaApiError("boom", error={
        "message": "generic", "error_data": {"details": "La categoría no coincide con el contenido"},
    })
    assert meta_service.describe_template_error(exc) == "La categoría no coincide con el contenido"


@pytest.mark.asyncio
async def test_upload_media_posts_multipart_and_returns_id(monkeypatch):
    _mock_config(monkeypatch)
    fake_client = _FakeGraphClient([_FakeGraphResponse({"id": "MEDIA123"})])
    monkeypatch.setattr(meta_service, "_client", lambda: fake_client)

    media_id = await meta_service.upload_media(b"fake-bytes", "image/jpeg", "foto.jpg")

    assert media_id == "MEDIA123"
    call = fake_client.calls[0]
    assert call["url"] == "https://graph.facebook.com/v26.0/PHONE1/media"
    assert call["files"]["file"] == ("foto.jpg", b"fake-bytes", "image/jpeg")
    assert call["data"]["messaging_product"] == "whatsapp"


@pytest.mark.asyncio
async def test_download_media_resolves_signed_url_then_fetches_bytes(monkeypatch):
    """Bajar un adjunto entrante de Meta son dos llamadas: la metadata da una
    URL firmada temporal, y esa URL igual exige el mismo Bearer (no es
    pública)."""
    _mock_config(monkeypatch)
    metadata = _FakeGraphResponse({
        "url": "https://lookaside.fbsbx.com/whatsapp/MEDIA1",
        "mime_type": "image/jpeg",
        "file_size": 1024,
        "id": "MEDIA1",
    })
    bytes_response = _FakeGraphResponse({})
    bytes_response.content = b"JPEG-BYTES"
    fake_client = _FakeGraphClient([metadata, bytes_response])
    monkeypatch.setattr(meta_service, "_client", lambda: fake_client)

    content, content_type = await meta_service.download_media("MEDIA1")

    assert content == b"JPEG-BYTES"
    assert content_type == "image/jpeg"
    assert fake_client.calls[0]["url"] == "https://graph.facebook.com/v26.0/MEDIA1"
    assert fake_client.calls[1]["url"] == "https://lookaside.fbsbx.com/whatsapp/MEDIA1"
    assert fake_client.calls[1]["headers"]["Authorization"] == "Bearer token-123"


@pytest.mark.asyncio
async def test_download_media_fails_when_meta_omits_the_url(monkeypatch):
    _mock_config(monkeypatch)
    monkeypatch.setattr(
        meta_service, "_client", lambda: _FakeGraphClient([_FakeGraphResponse({"id": "MEDIA1"})]),
    )

    with pytest.raises(meta_service.MetaApiError):
        await meta_service.download_media("MEDIA1")


@pytest.mark.asyncio
async def test_upload_header_media_two_step_flow(monkeypatch):
    monkeypatch.setattr(
        meta_service, "platform_setting", AsyncMock(return_value="APP123"),
    )
    _mock_config(monkeypatch)
    fake_client = _FakeGraphClient([
        _FakeGraphResponse({"id": "upload:SESSION1"}),
        _FakeGraphResponse({"h": "HEADER_HANDLE_XYZ"}),
    ])
    monkeypatch.setattr(meta_service, "_client", lambda: fake_client)

    handle = await meta_service.upload_header_media(b"fake-bytes", "image/jpeg", "foo.jpg")

    assert handle == "HEADER_HANDLE_XYZ"
    assert fake_client.calls[0]["url"] == "https://graph.facebook.com/v26.0/APP123/uploads"
    assert fake_client.calls[0]["params"]["file_length"] == len(b"fake-bytes")
    assert fake_client.calls[0]["params"]["access_token"] == "token-123"
    assert fake_client.calls[1]["url"] == "https://graph.facebook.com/v26.0/upload:SESSION1"
    assert fake_client.calls[1]["headers"]["Authorization"] == "OAuth token-123"
    assert fake_client.calls[1]["content"] == b"fake-bytes"


@pytest.mark.asyncio
async def test_upload_header_media_requires_app_id_setting(monkeypatch):
    monkeypatch.setattr(
        meta_service, "platform_setting", AsyncMock(return_value=""),
    )

    with pytest.raises(meta_service.MetaApiError):
        await meta_service.upload_header_media(b"fake-bytes", "image/jpeg", "foo.jpg")


@pytest.mark.asyncio
async def test_list_whatsapp_templates_follows_pagination(monkeypatch):
    _mock_config(monkeypatch)
    fake_client = _FakeGraphClient([
        _FakeGraphResponse({
            "data": [{"id": "1", "name": "a"}],
            "paging": {"next": "https://graph.facebook.com/v26.0/WABA1/message_templates?after=X"},
        }),
        _FakeGraphResponse({"data": [{"id": "2", "name": "b"}], "paging": {}}),
    ])
    monkeypatch.setattr(meta_service, "_client", lambda: fake_client)

    templates = await meta_service.list_whatsapp_templates()

    assert [t["id"] for t in templates] == ["1", "2"]
    assert fake_client.calls[0]["url"] == "https://graph.facebook.com/v26.0/WABA1/message_templates"
    assert fake_client.calls[1]["url"] == "https://graph.facebook.com/v26.0/WABA1/message_templates?after=X"
    # La URL de "next" ya trae todos los query params; no se le agregan de nuevo.
    assert fake_client.calls[1]["params"] is None


@pytest.mark.asyncio
async def test_mark_messages_as_read_sends_one_request_per_id(monkeypatch):
    _mock_config(monkeypatch)
    fake_client = _FakeGraphClient([
        _FakeGraphResponse({"success": True}),
        _FakeGraphResponse({"success": True}),
    ])
    monkeypatch.setattr(meta_service, "_client", lambda: fake_client)

    await meta_service.mark_messages_as_read("lead-1", ["WA-1", "WA-2"])

    assert len(fake_client.calls) == 2
    message_ids = {call["json"]["message_id"] for call in fake_client.calls}
    assert message_ids == {"WA-1", "WA-2"}
    assert all(call["json"]["status"] == "read" for call in fake_client.calls)


@pytest.mark.asyncio
async def test_http_client_is_reused_and_closed(monkeypatch):
    client = AsyncMock()
    client.is_closed = False
    factory = lambda **_kwargs: client
    monkeypatch.setattr(meta_service.httpx, "AsyncClient", factory)
    meta_service._http_client = None

    assert meta_service._client() is client
    assert meta_service._client() is client

    await meta_service.close_meta_client()
    client.aclose.assert_awaited_once_with()
    assert meta_service._http_client is None


def test_mediatype_from_content_type_defaults_to_document():
    assert mediatype_from_content_type("application/pdf") == "document"
    assert mediatype_from_content_type("image/png") == "image"



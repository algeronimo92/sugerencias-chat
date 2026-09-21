from unittest.mock import AsyncMock

import pytest

from services import meta_service
from services.message_media import media_message_fields, mediatype_from_content_type
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
async def test_send_text_strips_jid_suffix_and_carries_reply_context(monkeypatch):
    _mock_config(monkeypatch)
    monkeypatch.setattr(
        meta_service, "resolve_whatsapp_destination",
        AsyncMock(return_value="51906471403@s.whatsapp.net"),
    )
    fake_client = _FakeGraphClient([
        _FakeGraphResponse({
            "messages": [{"id": "wamid.XYZ"}],
            "contacts": [{"wa_id": "51906471403"}],
        }),
    ])
    monkeypatch.setattr(meta_service, "_client", lambda: fake_client)
    monkeypatch.setattr(meta_service, "learn_send_aliases", AsyncMock(return_value=()))

    result = await meta_service.send_whatsapp_text(
        "lead-1", "hola", quoted={"wa_message_id": "wamid.ORIGINAL"},
    )

    payload = fake_client.calls[0]["json"]
    assert payload["to"] == "51906471403"
    assert payload["type"] == "text"
    assert payload["text"] == {"body": "hola"}
    assert payload["context"] == {"message_id": "wamid.ORIGINAL"}
    assert result["key"]["id"] == "wamid.XYZ"
    assert result["key"]["remoteJid"] == "51906471403@s.whatsapp.net"


@pytest.mark.asyncio
async def test_send_contacts_builds_native_meta_contact_list(monkeypatch):
    _mock_config(monkeypatch)
    monkeypatch.setattr(
        meta_service, "resolve_whatsapp_destination",
        AsyncMock(return_value="51906471403@s.whatsapp.net"),
    )
    fake_client = _FakeGraphClient([
        _FakeGraphResponse({
            "messages": [{"id": "wamid.CONTACTS"}],
            "contacts": [{"wa_id": "51906471403"}],
        }),
    ])
    monkeypatch.setattr(meta_service, "_client", lambda: fake_client)
    monkeypatch.setattr(meta_service, "learn_send_aliases", AsyncMock(return_value=()))

    await meta_service.send_whatsapp_contacts(
        "lead-1",
        [
            {"fullName": "Ana Torres", "phoneNumber": "+51 911 111 111"},
            {"fullName": "Luis", "phoneNumber": "+51 922 222 222"},
        ],
        quoted={"wa_message_id": "wamid.ORIGINAL"},
    )

    payload = fake_client.calls[0]["json"]
    assert payload["type"] == "contacts"
    assert payload["context"] == {"message_id": "wamid.ORIGINAL"}
    assert payload["contacts"] == [
        {
            "name": {"formatted_name": "Ana Torres", "first_name": "Ana", "last_name": "Torres"},
            "phones": [{"phone": "+51911111111", "type": "CELL", "wa_id": "51911111111"}],
        },
        {
            "name": {"formatted_name": "Luis", "first_name": "Luis"},
            "phones": [{"phone": "+51922222222", "type": "CELL", "wa_id": "51922222222"}],
        },
    ]


@pytest.mark.asyncio
async def test_send_to_lid_only_lead_fails_explicitly(monkeypatch):
    """Un lead cuyo único identificador conocido es un @lid no se puede mandar
    directo por Meta (a diferencia de Evolution/Baileys, que lo resolvía a
    nivel de protocolo) — debe fallar claro, no con un error genérico."""
    _mock_config(monkeypatch)
    monkeypatch.setattr(
        meta_service, "resolve_whatsapp_destination",
        AsyncMock(return_value="267692862898397@lid"),
    )

    with pytest.raises(meta_service.MetaApiError):
        await meta_service.send_whatsapp_text("lead-1", "hola")


def _mock_media_send(monkeypatch, wamid="wamid.MEDIA"):
    """send_whatsapp_media hace dos llamadas: primero sube el archivo
    (POST /{phone_number_id}/media) y después manda el mensaje."""
    _mock_config(monkeypatch)
    monkeypatch.setattr(
        meta_service, "resolve_whatsapp_destination",
        AsyncMock(return_value="51906471403@s.whatsapp.net"),
    )
    fake_client = _FakeGraphClient([
        _FakeGraphResponse({"id": "MEDIA-1"}),
        _FakeGraphResponse({"messages": [{"id": wamid}], "contacts": [{"wa_id": "51906471403"}]}),
    ])
    monkeypatch.setattr(meta_service, "_client", lambda: fake_client)
    monkeypatch.setattr(meta_service, "learn_send_aliases", AsyncMock(return_value=()))
    return fake_client


@pytest.mark.asyncio
async def test_send_audio_marks_ogg_opus_as_a_voice_note(monkeypatch):
    fake_client = _mock_media_send(monkeypatch)

    await meta_service.send_whatsapp_audio("lead-1", b"OGG-BYTES", "audio/ogg", "nota.ogg")

    payload = fake_client.calls[1]["json"]
    assert payload["type"] == "audio"
    assert payload["audio"] == {"id": "MEDIA-1", "voice": True}


@pytest.mark.asyncio
async def test_send_audio_tolerates_codec_parameters_in_the_content_type(monkeypatch):
    """El navegador manda `audio/ogg; codecs=opus`: comparar el string entero
    contra "audio/ogg" perdería el flag y degradaría la nota de voz a adjunto."""
    fake_client = _mock_media_send(monkeypatch)

    await meta_service.send_whatsapp_audio(
        "lead-1", b"OGG-BYTES", "audio/ogg; codecs=opus", "nota.ogg",
    )

    assert fake_client.calls[1]["json"]["audio"]["voice"] is True


@pytest.mark.asyncio
async def test_send_audio_degrades_to_plain_attachment_for_other_formats(monkeypatch):
    """Meta solo acepta `voice: true` sobre Ogg/Opus. Si ffmpeg no estaba y el
    archivo quedó en el formato del navegador, reclamar el flag igual haría que
    Meta rechace el envío entero en vez de entregarlo como adjunto de audio."""
    fake_client = _mock_media_send(monkeypatch)

    await meta_service.send_whatsapp_audio("lead-1", b"WEBM-BYTES", "audio/webm", "nota.weba")

    assert fake_client.calls[1]["json"]["audio"] == {"id": "MEDIA-1"}


@pytest.mark.asyncio
async def test_send_media_never_leaks_voice_flag_into_other_types(monkeypatch):
    """`voice` solo existe dentro del objeto `audio` de la Cloud API. Mandarlo
    en un image/video/document viola el schema y Meta rechaza el envío entero
    con el error 100, así que ni siquiera debe aparecer como false."""
    fake_client = _mock_media_send(monkeypatch)

    await meta_service.send_whatsapp_media(
        "lead-1", b"JPG-BYTES", "image/jpeg", "image", filename="foto.jpg", voice=True,
    )

    assert fake_client.calls[1]["json"]["image"] == {"id": "MEDIA-1"}


@pytest.mark.asyncio
async def test_send_media_omits_voice_flag_by_default(monkeypatch):
    fake_client = _mock_media_send(monkeypatch)

    await meta_service.send_whatsapp_media(
        "lead-1", b"OGG-BYTES", "audio/ogg", "audio", filename="nota.ogg",
    )

    assert fake_client.calls[1]["json"]["audio"] == {"id": "MEDIA-1"}


@pytest.mark.asyncio
async def test_send_buttons_populates_header_body_and_footer_separately(monkeypatch):
    """Regresión del bug de Evolution (evolution-foundation/evolution-api#2723):
    su canal de Meta Cloud API solo mandaba `title` como cuerpo del mensaje e
    ignoraba description/footer. Acá los tres campos deben ir a header/body/
    footer por separado."""
    _mock_config(monkeypatch)
    monkeypatch.setattr(
        meta_service, "resolve_whatsapp_destination",
        AsyncMock(return_value="51906471403@s.whatsapp.net"),
    )
    fake_client = _FakeGraphClient([
        _FakeGraphResponse({"messages": [{"id": "wamid.BTN"}], "contacts": [{"wa_id": "51906471403"}]}),
    ])
    monkeypatch.setattr(meta_service, "_client", lambda: fake_client)
    monkeypatch.setattr(meta_service, "learn_send_aliases", AsyncMock(return_value=()))

    await meta_service.send_whatsapp_buttons(
        "lead-1", "Titulo", "Hola Gerson P lee esto", "DermicaPro",
        [
            {"type": "reply", "displayText": "opcion a", "id": "reply_1"},
            {"type": "reply", "displayText": "opcion b", "id": "reply_2"},
        ],
    )

    interactive = fake_client.calls[0]["json"]["interactive"]
    assert interactive["header"] == {"type": "text", "text": "Titulo"}
    assert interactive["body"] == {"text": "Hola Gerson P lee esto"}
    assert interactive["footer"] == {"text": "DermicaPro"}
    assert interactive["action"]["buttons"] == [
        {"type": "reply", "reply": {"id": "reply_1", "title": "opcion a"}},
        {"type": "reply", "reply": {"id": "reply_2", "title": "opcion b"}},
    ]


@pytest.mark.asyncio
async def test_send_buttons_omits_footer_when_blank(monkeypatch):
    _mock_config(monkeypatch)
    monkeypatch.setattr(
        meta_service, "resolve_whatsapp_destination",
        AsyncMock(return_value="51906471403@s.whatsapp.net"),
    )
    fake_client = _FakeGraphClient([
        _FakeGraphResponse({"messages": [{"id": "wamid.BTN"}], "contacts": [{"wa_id": "51906471403"}]}),
    ])
    monkeypatch.setattr(meta_service, "_client", lambda: fake_client)
    monkeypatch.setattr(meta_service, "learn_send_aliases", AsyncMock(return_value=()))

    await meta_service.send_whatsapp_buttons(
        "lead-1", "Titulo", "Cuerpo", "   ", [{"type": "reply", "displayText": "ok", "id": "r1"}],
    )

    assert "footer" not in fake_client.calls[0]["json"]["interactive"]


@pytest.mark.asyncio
async def test_send_list_translates_row_id_field_to_meta_id(monkeypatch):
    """El DTO de Evolution usa `rowId`; la Graph API de Meta espera `id`."""
    _mock_config(monkeypatch)
    monkeypatch.setattr(
        meta_service, "resolve_whatsapp_destination",
        AsyncMock(return_value="51906471403@s.whatsapp.net"),
    )
    fake_client = _FakeGraphClient([
        _FakeGraphResponse({"messages": [{"id": "wamid.LIST"}], "contacts": [{"wa_id": "51906471403"}]}),
    ])
    monkeypatch.setattr(meta_service, "_client", lambda: fake_client)
    monkeypatch.setattr(meta_service, "learn_send_aliases", AsyncMock(return_value=()))

    await meta_service.send_whatsapp_list(
        "lead-1", "Tratamientos", "Elegí uno", "DermicaPro", "Ver opciones",
        [{"title": "Faciales", "rows": [
            {"title": "Limpieza", "description": "60 min", "rowId": "trat_limpieza"},
        ]}],
    )

    sections = fake_client.calls[0]["json"]["interactive"]["action"]["sections"]
    assert sections == [{"title": "Faciales", "rows": [
        {"id": "trat_limpieza", "title": "Limpieza", "description": "60 min"},
    ]}]


@pytest.mark.asyncio
async def test_send_template_wraps_language_code(monkeypatch):
    _mock_config(monkeypatch)
    monkeypatch.setattr(
        meta_service, "resolve_whatsapp_destination",
        AsyncMock(return_value="51906471403@s.whatsapp.net"),
    )
    fake_client = _FakeGraphClient([
        _FakeGraphResponse({"messages": [{"id": "wamid.TPL"}], "contacts": [{"wa_id": "51906471403"}]}),
    ])
    monkeypatch.setattr(meta_service, "_client", lambda: fake_client)
    monkeypatch.setattr(meta_service, "learn_send_aliases", AsyncMock(return_value=()))

    await meta_service.send_whatsapp_template(
        "lead-1", "appointment", "es_PE", [{"type": "body", "parameters": []}],
    )

    payload = fake_client.calls[0]["json"]
    assert payload["type"] == "template"
    assert payload["template"] == {
        "name": "appointment",
        "language": {"code": "es_PE"},
        "components": [{"type": "body", "parameters": []}],
    }


@pytest.mark.asyncio
async def test_raise_meta_error_classifies_window_closed(monkeypatch):
    _mock_config(monkeypatch)
    monkeypatch.setattr(
        meta_service, "resolve_whatsapp_destination",
        AsyncMock(return_value="51906471403@s.whatsapp.net"),
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
        await meta_service.send_whatsapp_text("lead-1", "hola")


@pytest.mark.asyncio
async def test_raise_meta_error_generic_for_other_codes(monkeypatch):
    _mock_config(monkeypatch)
    monkeypatch.setattr(
        meta_service, "resolve_whatsapp_destination",
        AsyncMock(return_value="51906471403@s.whatsapp.net"),
    )
    fake_client = _FakeGraphClient([
        _FakeGraphResponse(
            {"error": {"message": "Invalid parameter", "type": "OAuthException", "code": 100}},
            is_error=True, status_code=400,
        ),
    ])
    monkeypatch.setattr(meta_service, "_client", lambda: fake_client)

    with pytest.raises(meta_service.MetaApiError) as excinfo:
        await meta_service.send_whatsapp_text("lead-1", "hola")
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
    pública). Evolution resolvía todo esto en un solo endpoint."""
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
        meta_service, "get_effective_many", AsyncMock(return_value={"meta_app_id": "APP123"}),
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
        meta_service, "get_effective_many", AsyncMock(return_value={"meta_app_id": ""}),
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
async def test_send_reaction_uses_jid_digits_directly_when_already_a_jid(monkeypatch):
    _mock_config(monkeypatch)
    fake_client = _FakeGraphClient([_FakeGraphResponse({"success": True})])
    monkeypatch.setattr(meta_service, "_client", lambda: fake_client)

    await meta_service.send_whatsapp_reaction(
        {"remoteJid": "51906471403@s.whatsapp.net", "fromMe": False, "id": "WA-1"}, "❤️",
    )

    payload = fake_client.calls[0]["json"]
    assert payload["to"] == "51906471403"
    assert payload["reaction"] == {"message_id": "WA-1", "emoji": "❤️"}


@pytest.mark.asyncio
async def test_send_reaction_resolves_lead_id_when_remote_jid_is_not_a_jid(monkeypatch):
    _mock_config(monkeypatch)
    fake_client = _FakeGraphClient([_FakeGraphResponse({"success": True})])
    monkeypatch.setattr(meta_service, "_client", lambda: fake_client)
    resolve = AsyncMock(return_value="51906471403@s.whatsapp.net")
    monkeypatch.setattr(meta_service, "resolve_whatsapp_destination", resolve)

    await meta_service.send_whatsapp_reaction(
        {"remoteJid": "7b08f4d9-855f-4718-b95f-9c021da52f77", "fromMe": False, "id": "WA-1"}, "❤️",
    )

    resolve.assert_awaited_once_with("7b08f4d9-855f-4718-b95f-9c021da52f77")
    assert fake_client.calls[0]["json"]["to"] == "51906471403"


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


def test_media_message_fields_document_keeps_filename():
    assert media_message_fields("document", "factura.pdf") == (
        "document", {"filename": "factura.pdf"},
    )


def test_mediatype_from_content_type_defaults_to_document():
    assert mediatype_from_content_type("application/pdf") == "document"
    assert mediatype_from_content_type("image/png") == "image"



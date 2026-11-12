from unittest.mock import AsyncMock

import base64

import pytest

from app.integrations.evolution import channel
from app.integrations.whatsapp.identity import Destination


@pytest.mark.asyncio
async def test_text_is_sent_by_the_instance_and_returns_provider_id(monkeypatch):
    monkeypatch.setattr(
        channel, "resolve_whatsapp_destination", AsyncMock(return_value=Destination("51987654321", None))
    )
    send = AsyncMock(return_value={"key": {"id": "EVO-1"}})
    monkeypatch.setattr(channel.client, "send_text", send)

    receipt = await channel.EvolutionMessageSender("evolution-org").send(
        "lead-1", {"type": "text", "text": {"body": "Hola"}}
    )

    send.assert_awaited_once_with("evolution-org", "51987654321", "Hola")
    assert receipt.provider_message_id == "EVO-1"
    assert receipt.sent_body["to"] == "51987654321"


@pytest.mark.asyncio
async def test_media_uses_the_data_prepared_by_upload(monkeypatch):
    monkeypatch.setattr(
        channel, "resolve_whatsapp_destination", AsyncMock(return_value=Destination("51987654321", None))
    )
    send = AsyncMock(return_value={"key": {"id": "EVO-2"}})
    monkeypatch.setattr(channel.client, "send_media", send)
    sender = channel.EvolutionMessageSender("evolution-org")
    encoded = await sender.upload_media(b"image", "image/jpeg", "foto.jpg")

    await sender.send("lead-1", {
        "type": "image",
        "image": {"id": encoded, "caption": "Resultado"},
    })

    # Evolution decodifica el campo como base64 puro; un data URI lo corrompe.
    assert encoded == base64.b64encode(b"image").decode("ascii")
    send.assert_awaited_once_with(
        "evolution-org",
        "51987654321",
        mediatype="image",
        media=encoded,
        caption="Resultado",
        filename=None,
    )


@pytest.mark.asyncio
async def test_destination_falls_back_to_user_id_when_wa_id_is_missing(monkeypatch):
    monkeypatch.setattr(
        channel, "resolve_whatsapp_destination", AsyncMock(return_value=Destination(None, "123456789@lid"))
    )
    send = AsyncMock(return_value={"key": {"id": "EVO-3"}})
    monkeypatch.setattr(channel.client, "send_text", send)

    receipt = await channel.EvolutionMessageSender("evolution-org").send(
        "lead-1", {"type": "text", "text": {"body": "Hola"}}
    )

    send.assert_awaited_once_with("evolution-org", "123456789@lid", "Hola")
    assert receipt.provider_message_id == "EVO-3"

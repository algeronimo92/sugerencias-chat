from unittest.mock import AsyncMock

import pytest

from routers import webhooks
from routers.webhooks import OutgoingWebhookBody


@pytest.mark.asyncio
async def test_external_outgoing_is_inserted_and_broadcast(monkeypatch):
    monkeypatch.setattr(webhooks, "_check_token", AsyncMock())
    # No hay gemelo de la app: es externo (Kommo/teléfono) -> se inserta.
    reconcile = AsyncMock(return_value={"matched": False, "message_id": 42})
    monkeypatch.setattr(webhooks, "reconcile_outgoing_message", reconcile)
    broadcast = AsyncMock()
    monkeypatch.setattr(webhooks.manager, "broadcast", broadcast)

    result = await webhooks.outgoing_webhook(
        OutgoingWebhookBody(
            chat_id="51999@s.whatsapp.net",
            message_type="text",
            content="En un momento se conecta un asesor para ayudarlo.",
            wa_message_id="EXT-1",
        )
    )

    reconcile.assert_awaited_once_with(
        "51999@s.whatsapp.net", "text", "En un momento se conecta un asesor para ayudarlo.",
        wa_message_id="EXT-1", media_url=None, payload=None,
    )
    broadcast.assert_awaited_once()
    assert result == {"status": "ok", "matched": False, "message_id": 42}


@pytest.mark.asyncio
async def test_own_echo_is_skipped_without_broadcast(monkeypatch):
    monkeypatch.setattr(webhooks, "_check_token", AsyncMock())
    # Ya existe el gemelo de la app: es eco de nuestro envío -> se descarta.
    monkeypatch.setattr(webhooks, "reconcile_outgoing_message", AsyncMock(return_value={"matched": True}))
    broadcast = AsyncMock()
    monkeypatch.setattr(webhooks.manager, "broadcast", broadcast)

    result = await webhooks.outgoing_webhook(
        OutgoingWebhookBody(chat_id="51999@s.whatsapp.net", content="Hola")
    )

    broadcast.assert_not_awaited()
    assert result == {"status": "ok", "matched": True}

from unittest.mock import AsyncMock

import pytest

from routers import webhooks
from routers.webhooks import OutgoingAnalysisWebhookBody

ANALYSIS = {"summary": "una imagen de una crema", "kind": "descripcion", "version": 1}


@pytest.mark.asyncio
async def test_merges_analysis_into_app_message(monkeypatch):
    monkeypatch.setattr(webhooks, "_check_token", AsyncMock())
    attach = AsyncMock(return_value={"matched": True, "message_id": 1253})
    monkeypatch.setattr(webhooks, "attach_outgoing_analysis", attach)
    broadcast = AsyncMock()
    monkeypatch.setattr(webhooks.manager, "broadcast", broadcast)

    result = await webhooks.outgoing_analysis_webhook(
        OutgoingAnalysisWebhookBody(
            chat_id="51999@s.whatsapp.net",
            message_type="image",
            analysis=ANALYSIS,
            wa_message_id="ECO-1",
            media_url="/media/x.jpg",
        )
    )

    attach.assert_awaited_once_with(
        "51999@s.whatsapp.net", "image", ANALYSIS,
        wa_message_id="ECO-1", content=None, media_url="/media/x.jpg",
    )
    broadcast.assert_awaited_once_with(
        {"type": "chats_updated", "chat_id": "51999@s.whatsapp.net", "reason": "analysis"}
    )
    assert result == {"status": "ok", "matched": True, "message_id": 1253}


@pytest.mark.asyncio
async def test_inserts_when_no_app_message_matches(monkeypatch):
    monkeypatch.setattr(webhooks, "_check_token", AsyncMock())
    # Media enviada desde el teléfono: no hay fila de la app, se inserta.
    monkeypatch.setattr(
        webhooks, "attach_outgoing_analysis",
        AsyncMock(return_value={"matched": False, "message_id": 1300}),
    )
    monkeypatch.setattr(webhooks.manager, "broadcast", AsyncMock())

    result = await webhooks.outgoing_analysis_webhook(
        OutgoingAnalysisWebhookBody(
            chat_id="51999@s.whatsapp.net", message_type="audio", analysis=ANALYSIS,
        )
    )

    assert result == {"status": "ok", "matched": False, "message_id": 1300}

"""Endpoints que reemplazan los UPDATE/SELECT directos que n8n hace sobre
`leads` y `wsp_messages` (ver docs/n8n-sin-acceso-a-la-base.md)."""

from datetime import date, datetime, timezone
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from routers import webhooks


@pytest.fixture(autouse=True)
def broadcast(monkeypatch):
    mock = AsyncMock()
    monkeypatch.setattr(webhooks.manager, "broadcast", mock)
    return mock


async def test_analysis_updates_only_the_fields_the_agent_resolved(monkeypatch, broadcast):
    update = AsyncMock(return_value={"chat_id": "lead-1"})
    monkeypatch.setattr(webhooks, "update_lead", update)

    result = await webhooks.lead_analysis_webhook(webhooks.LeadAnalysisWebhookBody(
        chat_id="lead-1", nombre="Ana", servicio_interes="Botox", fecha_recontacto=date(2026, 10, 1),
    ))

    assert result == {"status": "ok", "changed": True}
    update.assert_awaited_once_with(
        "lead-1",
        {"nombre": "Ana", "servicio_interes": "Botox", "fecha_recontacto": date(2026, 10, 1)},
        actor_type="agent",
    )
    assert broadcast.await_args.args[0]["reason"] == "lead_updated"


async def test_analysis_without_fields_does_not_touch_the_lead(monkeypatch):
    update = AsyncMock()
    monkeypatch.setattr(webhooks, "update_lead", update)

    assert await webhooks.lead_analysis_webhook(webhooks.LeadAnalysisWebhookBody(chat_id="lead-1")) == {
        "status": "ok", "changed": False,
    }
    update.assert_not_awaited()


async def test_analysis_of_a_missing_lead_is_404(monkeypatch):
    monkeypatch.setattr(webhooks, "update_lead", AsyncMock(return_value=None))

    with pytest.raises(HTTPException) as exc:
        await webhooks.lead_analysis_webhook(webhooks.LeadAnalysisWebhookBody(chat_id="lead-1", nombre="Ana"))

    assert exc.value.status_code == 404


async def test_inbound_activity_parses_the_timestamp(monkeypatch):
    update = AsyncMock(return_value={"chat_id": "lead-1"})
    monkeypatch.setattr(webhooks, "update_lead", update)

    await webhooks.lead_inbound_activity_webhook(webhooks.LeadInboundActivityWebhookBody(
        chat_id="lead-1", ultimo_emisor="cliente", ultimo_mensaje_at="2026-09-15T18:00:00Z",
    ))

    assert update.await_args.args[1] == {
        "ultimo_emisor": "cliente",
        "ultimo_mensaje_at": datetime(2026, 9, 15, 18, 0, tzinfo=timezone.utc),
    }


async def test_last_message_returns_an_empty_object_when_there_is_none(monkeypatch):
    monkeypatch.setattr(webhooks, "fetch_last_wa_message_id", AsyncMock(return_value=None))
    assert await webhooks.last_message_raw_webhook("lead-1") == {}

    monkeypatch.setattr(webhooks, "fetch_last_wa_message_id", AsyncMock(return_value="WA-9"))
    assert await webhooks.last_message_raw_webhook("lead-1") == {"wa_message_id": "WA-9"}

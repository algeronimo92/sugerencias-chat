from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from routers import webhooks


def _body(**overrides):
    payload = {
        "chat_id": "51999999999@s.whatsapp.net",
        "estado": "en_seguimiento",
        "razonamiento": "El vendedor habló último y pasaron 24 horas sin respuesta.",
    }
    payload.update(overrides)
    return webhooks.LeadStageWebhookBody(**payload)


@pytest.mark.asyncio
async def test_stage_change_records_reason_and_broadcasts(monkeypatch):
    monkeypatch.setattr(webhooks, "_check_token", AsyncMock())
    update_stage = AsyncMock(return_value={
        "chat_id": "51999999999@s.whatsapp.net",
        "stage": "en_seguimiento",
        "changed": True,
    })
    monkeypatch.setattr(webhooks, "update_lead_stage", update_stage)
    broadcast = AsyncMock()
    monkeypatch.setattr(webhooks.manager, "broadcast", broadcast)
    trigger = AsyncMock()
    monkeypatch.setattr(webhooks, "trigger_stage_changed", trigger)

    result = await webhooks.lead_stage_webhook(_body())

    update_stage.assert_awaited_once_with(
        "51999999999@s.whatsapp.net",
        webhooks.LeadStage.en_seguimiento,
        actor_type="agent",
        metadata={"reason": "El vendedor habló último y pasaron 24 horas sin respuesta."},
        include_chat=False,
    )
    broadcast.assert_awaited_once()
    assert broadcast.await_args.args[0]["reason"] == "stage_changed"
    trigger.assert_awaited_once_with("51999999999@s.whatsapp.net")
    assert result == {"status": "ok", "changed": True, "stage": "en_seguimiento"}


@pytest.mark.asyncio
async def test_unchanged_stage_skips_broadcast_and_automations(monkeypatch):
    monkeypatch.setattr(webhooks, "_check_token", AsyncMock())
    monkeypatch.setattr(webhooks, "update_lead_stage", AsyncMock(return_value={
        "chat_id": "51999999999@s.whatsapp.net",
        "stage": "en_seguimiento",
        "changed": False,
    }))
    broadcast = AsyncMock()
    monkeypatch.setattr(webhooks.manager, "broadcast", broadcast)
    trigger = AsyncMock()
    monkeypatch.setattr(webhooks, "trigger_stage_changed", trigger)

    result = await webhooks.lead_stage_webhook(_body())

    broadcast.assert_not_awaited()
    trigger.assert_not_awaited()
    assert result["changed"] is False


@pytest.mark.asyncio
async def test_null_stage_is_a_noop(monkeypatch):
    monkeypatch.setattr(webhooks, "_check_token", AsyncMock())
    update_stage = AsyncMock()
    monkeypatch.setattr(webhooks, "update_lead_stage", update_stage)

    result = await webhooks.lead_stage_webhook(_body(estado=None))

    update_stage.assert_not_awaited()
    assert result == {"status": "ok", "changed": False, "stage": None}


@pytest.mark.asyncio
async def test_invalid_stage_returns_422_with_valid_options(monkeypatch):
    monkeypatch.setattr(webhooks, "_check_token", AsyncMock())

    with pytest.raises(HTTPException) as exc:
        await webhooks.lead_stage_webhook(_body(estado="cierre"))

    assert exc.value.status_code == 422
    assert "en_seguimiento" in exc.value.detail


@pytest.mark.asyncio
async def test_missing_lead_returns_404(monkeypatch):
    monkeypatch.setattr(webhooks, "_check_token", AsyncMock())
    monkeypatch.setattr(webhooks, "update_lead_stage", AsyncMock(return_value=None))

    with pytest.raises(HTTPException) as exc:
        await webhooks.lead_stage_webhook(_body())

    assert exc.value.status_code == 404

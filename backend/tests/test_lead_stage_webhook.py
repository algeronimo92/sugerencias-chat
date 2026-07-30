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
async def test_unchanged_stage_notifies_panels_but_skips_automations(monkeypatch):
    """Mantener la etapa es la respuesta más frecuente del analista, y aun así
    reescribió nombre, teléfono y notas con un UPDATE directo. Sin el aviso, el
    CRM se queda con los datos viejos: con el WebSocket conectado no hay
    polling que lo salve."""
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

    broadcast.assert_awaited_once()
    assert broadcast.await_args.args[0] == {
        "type": "chats_updated",
        "chat_id": "51999999999@s.whatsapp.net",
        "reason": "lead_updated",
    }
    # La etapa no se movió: disparar las automatizaciones de cambio de etapa
    # aquí las repetiría en cada mensaje del cliente.
    trigger.assert_not_awaited()
    assert result["changed"] is False


@pytest.mark.asyncio
async def test_null_stage_only_notifies_panels(monkeypatch):
    """n8n puede llamar siempre sin un nodo IF adelante: sin etapa no se toca
    `leads.estado`, pero el resto del lead sí pudo cambiar."""
    update_stage = AsyncMock()
    monkeypatch.setattr(webhooks, "update_lead_stage", update_stage)
    broadcast = AsyncMock()
    monkeypatch.setattr(webhooks.manager, "broadcast", broadcast)

    result = await webhooks.lead_stage_webhook(_body(estado=None))

    update_stage.assert_not_awaited()
    broadcast.assert_awaited_once()
    assert broadcast.await_args.args[0]["reason"] == "lead_updated"
    assert result == {"status": "ok", "changed": False, "stage": None}


@pytest.mark.asyncio
async def test_invalid_stage_returns_422_with_valid_options(monkeypatch):

    with pytest.raises(HTTPException) as exc:
        await webhooks.lead_stage_webhook(_body(estado="cierre"))

    assert exc.value.status_code == 422
    assert "en_seguimiento" in exc.value.detail


@pytest.mark.asyncio
async def test_missing_lead_returns_404(monkeypatch):
    monkeypatch.setattr(webhooks, "update_lead_stage", AsyncMock(return_value=None))

    with pytest.raises(HTTPException) as exc:
        await webhooks.lead_stage_webhook(_body())

    assert exc.value.status_code == 404

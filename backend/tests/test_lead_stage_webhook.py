"""Webhook de n8n que mueve la etapa: pasa por el mismo comando que el kanban."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from app.integrations.n8n import api as webhooks
from app.integrations.n8n.webhook_schemas import LeadStageWebhookBody
from app.modules.leads.domain.errors import LeadNotFound
from app.modules.leads.domain.events import LeadStageChanged
from tests.conftest import patch_webhooks

LEAD_ID = "7b08f4d9-855f-4718-b95f-9c021da52f77"
REASON = "El vendedor habló último y pasaron 24 horas sin respuesta."


def _body(**overrides):
    payload = {"chat_id": LEAD_ID, "estado": "calificado", "razonamiento": REASON}
    payload.update(overrides)
    return LeadStageWebhookBody(**payload)


@pytest.fixture
def broadcast(monkeypatch):
    mock = AsyncMock()
    patch_webhooks(monkeypatch, "manager", SimpleNamespace(broadcast=mock))
    return mock


async def test_stage_change_is_audited_as_the_agent(in_memory_leads, broadcast):
    in_memory_leads.repository.seed(LEAD_ID)

    result = await webhooks.lead_stage_webhook(_body())

    assert result == {"status": "ok", "changed": True, "stage": "calificado"}
    [record] = in_memory_leads.repository.audit(LEAD_ID)
    assert (record.actor.type, record.metadata["reason"]) == ("agent", REASON)
    [event] = in_memory_leads.published
    assert isinstance(event, LeadStageChanged) and event.triggers_automations
    # El aviso del cambio de etapa lo emite su suscriptor, no el webhook.
    broadcast.assert_not_awaited()


async def test_unchanged_stage_notifies_panels_but_changes_nothing(in_memory_leads, broadcast):
    """Mantener la etapa es la respuesta más frecuente del analista, y aun así
    reescribió nombre, teléfono y notas. Sin el aviso, el CRM se queda con los
    datos viejos: con el WebSocket conectado no hay polling que lo salve."""
    in_memory_leads.repository.seed(LEAD_ID, stage="calificado")

    result = await webhooks.lead_stage_webhook(_body())

    assert result["changed"] is False
    assert in_memory_leads.published == []
    broadcast.assert_awaited_once()
    assert broadcast.await_args.args[0] == {"type": "chats_updated", "chat_id": LEAD_ID, "reason": "lead_updated"}


async def test_null_stage_only_notifies_panels(in_memory_leads, broadcast):
    """n8n puede llamar siempre sin un nodo IF adelante."""
    result = await webhooks.lead_stage_webhook(_body(estado=None))

    assert result == {"status": "ok", "changed": False, "stage": None}
    assert broadcast.await_args.args[0]["reason"] == "lead_updated"


async def test_stage_unknown_to_the_business_returns_422(in_memory_leads, broadcast):
    in_memory_leads.repository.seed(LEAD_ID)

    with pytest.raises(HTTPException) as exc:
        await webhooks.lead_stage_webhook(_body(estado="cierre"))

    assert exc.value.status_code == 422
    assert exc.value.detail.startswith("Estado inválido:") and "cierre" in exc.value.detail


async def test_missing_lead_returns_404(in_memory_leads, broadcast):
    with pytest.raises(LeadNotFound) as exc:
        await webhooks.lead_stage_webhook(_body())

    assert exc.value.status_code == 404

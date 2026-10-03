"""Endpoints que reemplazan los UPDATE/SELECT directos que n8n hace sobre
`leads` y `wsp_messages` (ver docs/n8n-sin-acceso-a-la-base.md)."""

from datetime import date, datetime, timezone
from unittest.mock import AsyncMock

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.integrations.n8n import api as webhooks
from app.integrations.n8n.webhook_schemas import LeadAnalysisWebhookBody, LeadInboundActivityWebhookBody
from app.modules.leads.domain.errors import LeadNotFound
from tests.conftest import patch_webhooks
from app.realtime import ws_manager


@pytest.fixture(autouse=True)
def broadcast(monkeypatch):
    mock = AsyncMock()
    monkeypatch.setattr(ws_manager.manager, "broadcast", mock)
    return mock


async def test_analysis_updates_only_the_fields_the_agent_resolved(in_memory_leads):
    repository = in_memory_leads.repository
    repository.seed("lead-1", nombre="Ana", notas="previa")

    result = await webhooks.lead_analysis_webhook(LeadAnalysisWebhookBody(
        chat_id="lead-1", nombre="Ana", servicio_interes="Botox", fecha_recontacto=date(2026, 10, 1),
    ))

    assert result == {"status": "ok", "changed": True}
    [record] = repository.audit("lead-1")
    assert record.actor.type == "agent"
    # Solo lo que cambió queda en la auditoría; las notas no se tocaron.
    assert record.new_value == {"servicio_interes": "Botox", "fecha_recontacto": "2026-10-01"}
    assert repository.column("lead-1", "notas") == "previa"


async def test_analysis_without_fields_does_not_touch_the_lead(in_memory_leads):
    assert await webhooks.lead_analysis_webhook(LeadAnalysisWebhookBody(chat_id="lead-1")) == {
        "status": "ok", "changed": False,
    }
    assert in_memory_leads.published == []


async def test_analysis_of_a_missing_lead_is_404(in_memory_leads):
    with pytest.raises(LeadNotFound) as exc:
        await webhooks.lead_analysis_webhook(LeadAnalysisWebhookBody(chat_id="lead-1", nombre="Ana"))

    assert exc.value.status_code == 404


async def test_inbound_activity_parses_the_timestamp(in_memory_leads):
    in_memory_leads.repository.seed("lead-1")

    await webhooks.lead_inbound_activity_webhook(LeadInboundActivityWebhookBody(
        chat_id="lead-1", ultimo_emisor="cliente", ultimo_mensaje_at="2026-09-15T18:00:00Z",
    ))

    assert in_memory_leads.repository.column("lead-1", "ultimo_mensaje_at") == datetime(
        2026, 9, 15, 18, 0, tzinfo=timezone.utc,
    )
    assert in_memory_leads.repository.column("lead-1", "ultimo_emisor") == "cliente"


async def test_last_message_returns_an_empty_object_when_there_is_none(monkeypatch):
    patch_webhooks(monkeypatch, "fetch_last_wa_message_id", AsyncMock(return_value=None))
    assert await webhooks.last_message_raw_webhook("lead-1") == {}

    patch_webhooks(monkeypatch, "fetch_last_wa_message_id", AsyncMock(return_value="WA-9"))
    assert await webhooks.last_message_raw_webhook("lead-1") == {"wa_message_id": "WA-9"}

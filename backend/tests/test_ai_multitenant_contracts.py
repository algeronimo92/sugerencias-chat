from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from config import settings
from db.models import LeadStage
from models.schemas import SuggestionRequest, SuggestionResponse
from models.webhook_schemas import (
    LeadAnalysisPatch,
    LeadAnalysisResultWebhookBody,
    LeadAnalysisWebhookBody,
    RagSearchWebhookBody,
)
from routers import suggestions, webhooks
from services import n8n_service
from services.ai_job_tokens import AIJobClaims, decode_ai_job_token, issue_ai_job_token
from services.ai_jobs import AIContextStale
from services.knowledge_search import _escape_like
from tests.conftest import patch_webhooks


JOB_ID = "5e0dd73e-80c7-4a9d-82a9-b4a670c8b90d"
ORG_ID = UUID("68b010ae-8f9b-4f47-ab57-c74048923081")


def _claims(operation: str = "analyst") -> AIJobClaims:
    return AIJobClaims(
        organization_id=ORG_ID,
        job_id=JOB_ID,
        operation=operation,
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
    )


def test_analysis_patch_distinguishes_absent_from_explicit_null():
    patch = LeadAnalysisPatch(nombre=None, proxima_cita=None, con_especialista=True)
    assert patch.model_fields_set == {"nombre", "proxima_cita", "con_especialista"}
    assert patch.model_dump(include=patch.model_fields_set) == {
        "nombre": None,
        "proxima_cita": None,
        "con_especialista": True,
    }


def test_legacy_analysis_rejects_protected_database_fields():
    with pytest.raises(ValidationError):
        LeadAnalysisWebhookBody(
            chat_id="lead-1",
            nombre="Ana",
            conversacion_version=0,
            automatizacion_pausada=False,
        )


async def test_legacy_analysis_forwards_null_and_appointment_fields(monkeypatch):
    update = AsyncMock(return_value={"id": "lead-1"})
    patch_webhooks(monkeypatch, "update_lead", update)
    patch_webhooks(monkeypatch, "_broadcast_lead_updated", AsyncMock())

    await webhooks.lead_analysis_webhook(
        LeadAnalysisWebhookBody(
            chat_id="lead-1",
            nombre=None,
            fecha_recontacto=date(2026, 10, 2),
            proxima_cita=datetime(2026, 10, 3, 15, 0, tzinfo=timezone.utc),
            con_especialista=True,
        )
    )

    values = update.await_args.args[1]
    assert values["nombre"] is None
    assert values["proxima_cita"].tzinfo is not None
    assert values["con_especialista"] is True


async def test_analysis_job_applies_one_atomic_patch(monkeypatch):
    apply = AsyncMock(
        return_value=(
            {"status": "ok", "job_id": JOB_ID, "applied": True, "changed": True},
            2,
        )
    )
    patch_webhooks(monkeypatch, "apply_analysis_job_atomic", apply)
    broadcast = AsyncMock()
    notify = AsyncMock()
    patch_webhooks(monkeypatch, "_broadcast_lead_updated", broadcast)
    patch_webhooks(monkeypatch, "notify_automations_scheduled", notify)
    body = LeadAnalysisResultWebhookBody(
        chat_id="lead-1",
        context_revision="v1:abc",
        fields={"notas": None, "con_especialista": True},
        estado="calificado",
        razonamiento="Pidio una cita",
    )

    result = await webhooks.apply_analysis_job_webhook(
        JOB_ID, body, JOB_ID, _claims()
    )

    assert result["applied"] is True
    assert apply.await_args.kwargs["values"] == {
        "notas": None,
        "con_especialista": True,
    }
    assert apply.await_args.kwargs["stage"] == LeadStage.calificado
    broadcast.assert_awaited_once_with("lead-1")
    notify.assert_awaited_once_with(2)


async def test_analysis_job_maps_stale_result_to_conflict(monkeypatch):
    patch_webhooks(
        monkeypatch,
        "apply_analysis_job_atomic",
        AsyncMock(side_effect=AIContextStale("v1:new")),
    )
    body = LeadAnalysisResultWebhookBody(
        chat_id="lead-1", context_revision="v1:old", fields={"nombre": "Ana"}
    )
    with pytest.raises(HTTPException) as exc:
        await webhooks.apply_analysis_job_webhook(JOB_ID, body, JOB_ID, _claims())
    assert exc.value.status_code == 409
    assert exc.value.detail["current_revision"] == "v1:new"


async def test_rag_search_is_scoped_by_job_and_revision(monkeypatch):
    patch_webhooks(
        monkeypatch,
        "start_ai_job",
        AsyncMock(return_value=SimpleNamespace(chat_id="lead-1", resource_id="lead-1")),
    )
    patch_webhooks(monkeypatch, "fetch_context_revision", AsyncMock(return_value="v1:ok"))
    search = AsyncMock(return_value=[{"id": "chunk-1", "content": "Botox"}])
    patch_webhooks(monkeypatch, "search_knowledge_chunks", search)
    patch_webhooks(monkeypatch, "record_ai_job_step", AsyncMock(return_value=True))

    result = await webhooks.rag_search_webhook(
        RagSearchWebhookBody(query="precio botox", context_revision="v1:ok", top_k=4),
        JOB_ID,
        _claims("rag"),
    )

    assert result["count"] == 1
    search.assert_awaited_once_with("precio botox", 4)


def test_ai_job_token_binds_org_job_operation_and_expiry(monkeypatch):
    monkeypatch.setattr(settings, "ai_job_signing_secret", "unit-test-signing-secret")
    expires = datetime.now(timezone.utc) + timedelta(minutes=2)
    token = issue_ai_job_token(ORG_ID, JOB_ID, "rag", expires)
    claims = decode_ai_job_token(token)
    assert claims.organization_id == ORG_ID
    assert claims.job_id == JOB_ID
    assert claims.operation == "rag"

    encoded, signature = token.split(".", 1)
    with pytest.raises(HTTPException) as exc:
        decode_ai_job_token(f"{encoded}.{signature[:-1]}x")
    assert exc.value.status_code == 401


async def test_rag_response_never_changes_stage(monkeypatch):
    monkeypatch.setattr(suggestions, "get_cached_suggestion", AsyncMock(return_value=None))
    monkeypatch.setattr(suggestions, "fetch_context_revision", AsyncMock(return_value="v1:ok"))
    monkeypatch.setattr(suggestions, "get_current_tenant", lambda: None)
    monkeypatch.setattr(
        suggestions,
        "call_n8n",
        AsyncMock(
            return_value=SuggestionResponse(
                estado="calificado",
                confianza="alta",
                analisis="Hay interes",
                sugerencias=[],
            )
        ),
    )
    cache = AsyncMock(return_value="cached")
    monkeypatch.setattr(suggestions, "cache_suggestion_if_current", cache)

    result = await suggestions.get_suggestions(
        SuggestionRequest(chat_id="lead-1", force=True)
    )

    assert result.estado == LeadStage.calificado
    cache.assert_awaited_once()
    assert not hasattr(suggestions, "update_lead_stage")


def test_knowledge_fallback_escapes_like_wildcards():
    assert _escape_like(r"50%_promo\\hoy") == r"50\%\_promo\\\\hoy"


async def test_rag_dispatch_sends_operation_job_revision_and_tenant_token(monkeypatch):
    response = SimpleNamespace(
        raise_for_status=lambda: None,
        json=lambda: [{
            "output": {
                "confianza": "alta",
                "analisis": "Contexto vigente",
                "sugerencias": [],
            }
        }],
    )
    client = SimpleNamespace(get=AsyncMock(return_value=response))
    monkeypatch.setattr(n8n_service, "_client", lambda: client)
    monkeypatch.setattr(
        n8n_service,
        "get_effective_many",
        AsyncMock(return_value={
            "n8n_webhook_url": "https://n8n.test/rag",
            "n8n_webhook_token": "outbound-secret",
        }),
    )

    await n8n_service.call_n8n(
        "lead-1",
        None,
        operation="rag",
        job_id=JOB_ID,
        context_revision="v1:abc",
        tenant_context_token="signed-context",
    )

    kwargs = client.get.await_args.kwargs
    assert kwargs["params"] == {
        "chat_id": "lead-1",
        "operation": "rag",
        "job_id": JOB_ID,
        "context_revision": "v1:abc",
    }
    assert kwargs["headers"]["X-Job-Id"] == JOB_ID
    assert kwargs["headers"]["X-Tenant-Context"] == "signed-context"

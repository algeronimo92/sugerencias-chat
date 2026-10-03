from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.core.config import settings
from app.modules.ai.schemas import SuggestionRequest, SuggestionResponse
from app.integrations.n8n.webhook_schemas import (
    LeadAnalysisPatch,
    LeadAnalysisResultWebhookBody,
    LeadAnalysisWebhookBody,
    RagSearchWebhookBody,
)
from app.modules.ai import suggestions_api as suggestions
from app.integrations.n8n import api as webhooks
from app.modules.ai import ai_access
from app.integrations.n8n import client as n8n_service
from app.modules.ai.ai_job_tokens import AIJobClaims, decode_ai_job_token, issue_ai_job_token
from app.modules.ai.ai_jobs import AIContextStale, AIJobConflict
from app.modules.ai.knowledge_search import _escape_like
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
        return_value={"status": "ok", "job_id": JOB_ID, "applied": True, "changed": True}
    )
    patch_webhooks(monkeypatch, "apply_analysis_job_atomic", apply)
    broadcast = AsyncMock()
    patch_webhooks(monkeypatch, "_broadcast_lead_updated", broadcast)
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
    assert apply.await_args.kwargs["stage"] == "calificado"
    broadcast.assert_awaited_once_with("lead-1")
    # Las automatizaciones que agendó el cambio de etapa despiertan al motor
    # desde su suscriptor, no desde el webhook.


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


def _stub_rag_job(monkeypatch) -> AsyncMock:
    """Job RAG ya autorizado: el workflow cargó el contexto por el endpoint scoped."""

    monkeypatch.setattr(suggestions, "ensure_ai_available", AsyncMock(return_value=None))
    job = SimpleNamespace(id=JOB_ID, expires_at=datetime.now(timezone.utc) + timedelta(minutes=5))
    monkeypatch.setattr(
        suggestions,
        "create_ai_job",
        AsyncMock(return_value=(job, SimpleNamespace(organization_id=ORG_ID))),
    )
    monkeypatch.setattr(suggestions, "issue_ai_job_token", lambda *_args: "signed-context")
    monkeypatch.setattr(
        suggestions,
        "get_ai_job",
        AsyncMock(return_value=SimpleNamespace(
            request_metadata={"completed_steps": ["context_loaded"]}
        )),
    )
    finish = AsyncMock(return_value=True)
    monkeypatch.setattr(suggestions, "finish_ai_job", finish)
    return finish


async def test_rag_response_never_changes_stage(monkeypatch):
    monkeypatch.setattr(suggestions, "get_cached_suggestion", AsyncMock(return_value=None))
    monkeypatch.setattr(suggestions, "fetch_context_revision", AsyncMock(return_value="v1:ok"))
    finish = _stub_rag_job(monkeypatch)
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

    assert result.estado == "calificado"
    cache.assert_awaited_once()
    assert not hasattr(suggestions, "update_lead_stage")
    assert finish.await_args.kwargs["status"] == "succeeded"


async def test_suggestions_without_tenant_never_reach_the_workflow(monkeypatch):
    monkeypatch.setattr(suggestions, "get_cached_suggestion", AsyncMock(return_value=None))
    monkeypatch.setattr(suggestions, "fetch_context_revision", AsyncMock(return_value="v1:ok"))
    monkeypatch.setattr(ai_access, "get_current_tenant", lambda: None)
    call = AsyncMock()
    monkeypatch.setattr(suggestions, "call_n8n", call)

    with pytest.raises(HTTPException) as exc:
        await suggestions.get_suggestions(SuggestionRequest(chat_id="lead-1", force=True))

    assert exc.value.status_code == 503
    call.assert_not_awaited()


@pytest.mark.parametrize(
    ("entitlement", "used", "status", "code"),
    [
        (ai_access.AIEntitlement(enabled=False, monthly_quota=None), 0, 403, "ai_disabled"),
        (ai_access.AIEntitlement(enabled=True, monthly_quota=10), 10, 429, "ai_quota_exceeded"),
    ],
)
async def test_platform_entitlement_blocks_generation_before_creating_a_job(
    monkeypatch, entitlement, used, status, code
):
    monkeypatch.setattr(suggestions, "get_cached_suggestion", AsyncMock(return_value=None))
    monkeypatch.setattr(suggestions, "fetch_context_revision", AsyncMock(return_value="v1:ok"))
    monkeypatch.setattr(
        ai_access, "get_current_tenant", lambda: SimpleNamespace(organization_id=ORG_ID)
    )
    monkeypatch.setattr(ai_access, "get_entitlement", AsyncMock(return_value=entitlement))
    monkeypatch.setattr(ai_access, "count_usage_this_month", AsyncMock(return_value=used))
    monkeypatch.setattr(ai_access, "platform_ready", AsyncMock(return_value=True))
    create = AsyncMock()
    monkeypatch.setattr(suggestions, "create_ai_job", create)

    with pytest.raises(HTTPException) as exc:
        await suggestions.get_suggestions(SuggestionRequest(chat_id="lead-1", force=True))

    assert exc.value.status_code == status
    assert exc.value.detail["code"] == code
    # El mensaje es para el vendedor: explica el motivo, no un código técnico.
    assert "plan" in exc.value.detail["message"] or "este mes" in exc.value.detail["message"]
    create.assert_not_awaited()


def _enabled_tenant(monkeypatch, *, quota=None, used=0, ready=True):
    monkeypatch.setattr(suggestions, "get_cached_suggestion", AsyncMock(return_value=None))
    monkeypatch.setattr(suggestions, "fetch_context_revision", AsyncMock(return_value="v1:ok"))
    monkeypatch.setattr(
        ai_access, "get_current_tenant", lambda: SimpleNamespace(organization_id=ORG_ID)
    )
    monkeypatch.setattr(
        ai_access,
        "get_entitlement",
        AsyncMock(return_value=ai_access.AIEntitlement(enabled=True, monthly_quota=quota)),
    )
    monkeypatch.setattr(ai_access, "count_usage_this_month", AsyncMock(return_value=used))
    monkeypatch.setattr(ai_access, "platform_ready", AsyncMock(return_value=ready))


async def test_unconfigured_platform_explains_instead_of_crashing(monkeypatch):
    _enabled_tenant(monkeypatch, ready=False)
    create = AsyncMock()
    monkeypatch.setattr(suggestions, "create_ai_job", create)

    with pytest.raises(HTTPException) as exc:
        await suggestions.get_suggestions(SuggestionRequest(chat_id="lead-1", force=True))

    assert exc.value.status_code == 503
    assert exc.value.detail["code"] == "ai_not_configured"
    create.assert_not_awaited()


async def test_platform_needs_signing_secret_and_workflow_url(monkeypatch):
    monkeypatch.setattr(ai_access, "signing_key_configured", lambda: False)
    monkeypatch.setattr(ai_access, "platform_setting", AsyncMock(return_value="https://n8n.test/rag"))
    assert await ai_access.platform_ready("rag") is False

    monkeypatch.setattr(ai_access, "signing_key_configured", lambda: True)
    monkeypatch.setattr(ai_access, "platform_setting", AsyncMock(return_value=""))
    assert await ai_access.platform_ready("analyst") is False

    monkeypatch.setattr(ai_access, "platform_setting", AsyncMock(return_value="https://n8n.test/rag"))
    assert await ai_access.platform_ready("rag") is True


async def test_signing_failure_closes_the_job_instead_of_leaving_it_pending(monkeypatch):
    _enabled_tenant(monkeypatch)
    job = SimpleNamespace(id=JOB_ID, expires_at=datetime.now(timezone.utc) + timedelta(minutes=5))
    monkeypatch.setattr(
        suggestions,
        "create_ai_job",
        AsyncMock(return_value=(job, SimpleNamespace(organization_id=ORG_ID))),
    )

    def fail_signing(*_args):
        raise RuntimeError("AI_JOB_SIGNING_SECRET is required for multitenant AI jobs")

    monkeypatch.setattr(suggestions, "issue_ai_job_token", fail_signing)
    finish = AsyncMock(return_value=True)
    monkeypatch.setattr(suggestions, "finish_ai_job", finish)
    call = AsyncMock()
    monkeypatch.setattr(suggestions, "call_n8n", call)

    with pytest.raises(HTTPException) as exc:
        await suggestions.get_suggestions(SuggestionRequest(chat_id="lead-1", force=True))

    assert exc.value.status_code == 503
    assert exc.value.detail["code"] == "ai_not_configured"
    assert finish.await_args.kwargs["status"] == "failed"
    call.assert_not_awaited()


async def test_workflow_failure_is_reported_as_retryable(monkeypatch):
    _enabled_tenant(monkeypatch)
    finish = _stub_rag_job(monkeypatch)
    monkeypatch.setattr(suggestions, "call_n8n", AsyncMock(side_effect=RuntimeError("n8n caido")))

    with pytest.raises(HTTPException) as exc:
        await suggestions.get_suggestions(SuggestionRequest(chat_id="lead-1", force=True))

    assert exc.value.status_code == 502
    assert exc.value.detail["code"] == "ai_workflow_failed"
    assert finish.await_args.kwargs["status"] == "failed"


@pytest.mark.parametrize("status", [401, 403, 404])
async def test_workflow_rejecting_the_backend_is_a_configuration_problem(monkeypatch, status):
    import httpx

    _enabled_tenant(monkeypatch)
    _stub_rag_job(monkeypatch)
    request = httpx.Request("GET", "https://n8n.test/webhook/sugerencias")
    rejection = httpx.HTTPStatusError(
        "rechazado", request=request, response=httpx.Response(status, request=request)
    )
    monkeypatch.setattr(suggestions, "call_n8n", AsyncMock(side_effect=rejection))

    with pytest.raises(HTTPException) as exc:
        await suggestions.get_suggestions(SuggestionRequest(chat_id="lead-1", force=True))

    assert exc.value.status_code == 503
    assert exc.value.detail["code"] == "ai_workflow_rejected"


async def test_zero_quota_reads_as_not_included(monkeypatch):
    _enabled_tenant(monkeypatch, quota=0, used=0)

    with pytest.raises(ai_access.AIUnavailableError) as exc:
        await ai_access.ensure_ai_available("rag")

    assert exc.value.code == "ai_quota_exceeded"
    assert "no incluye" in exc.value.message


async def test_quota_counts_only_up_to_the_limit(monkeypatch):
    monkeypatch.setattr(
        ai_access, "get_current_tenant", lambda: SimpleNamespace(organization_id=ORG_ID)
    )
    monkeypatch.setattr(
        ai_access,
        "get_entitlement",
        AsyncMock(return_value=ai_access.AIEntitlement(enabled=True, monthly_quota=10)),
    )
    monkeypatch.setattr(ai_access, "count_usage_this_month", AsyncMock(return_value=9))
    monkeypatch.setattr(ai_access, "platform_ready", AsyncMock(return_value=True))

    await ai_access.ensure_ai_available()
    summary = await ai_access.usage_summary()

    assert summary == {"enabled": True, "monthly_quota": 10, "used_this_month": 9, "remaining": 1}


def test_quota_month_starts_at_utc_midnight_of_day_one():
    now = datetime(2026, 9, 23, 22, 5, tzinfo=timezone.utc)
    assert ai_access.month_start(now) == datetime(2026, 9, 1, tzinfo=timezone.utc)


async def test_rag_context_carries_the_business_profile_and_resources(monkeypatch):
    patch_webhooks(monkeypatch, "start_ai_job", AsyncMock(
        return_value=SimpleNamespace(context_revision="v1:ok")
    ))
    patch_webhooks(monkeypatch, "fetch_analysis_context", AsyncMock(return_value={
        "context_revision": "v1:ok",
        "lead": {"id": "lead-1"},
        "messages": [],
        "message_cursor": None,
    }))
    patch_webhooks(monkeypatch, "record_ai_job_step", AsyncMock(return_value=True))
    patch_webhooks(monkeypatch, "fetch_tenant_config", AsyncMock(
        return_value={"negocio": {"nombre": "Clinica Norte"}, "moneda": "PEN"}
    ))
    patch_webhooks(monkeypatch, "list_ai_resources", AsyncMock(
        return_value=[{"id": 7, "nombre": "flyer.png", "descripcion": "Promo de octubre"}]
    ))

    result = await webhooks.rag_context_webhook("lead-1", 500, JOB_ID, _claims("rag"))

    assert result["tenant_config"]["negocio"]["nombre"] == "Clinica Norte"
    assert result["resources"][0]["descripcion"] == "Promo de octubre"


async def test_catalog_tool_returns_prices_with_the_business_currency(monkeypatch):
    patch_webhooks(monkeypatch, "start_ai_job", AsyncMock(return_value=SimpleNamespace()))
    patch_webhooks(monkeypatch, "fetch_tenant_config", AsyncMock(return_value={"moneda": "PEN"}))
    patch_webhooks(monkeypatch, "list_ai_catalog", AsyncMock(return_value=[
        {"id": 1, "name": "Limpieza facial", "description": None, "price": "150.00", "price_notes": None}
    ]))

    result = await webhooks.ai_catalog_webhook(JOB_ID, _claims("rag"))

    assert result == {
        "currency": "PEN",
        "services": [
            {"id": 1, "name": "Limpieza facial", "description": None, "price": "150.00", "price_notes": None}
        ],
    }


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
        "platform_settings_many",
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


async def test_retrying_an_old_n8n_execution_says_the_job_already_finished(monkeypatch):
    patch_webhooks(
        monkeypatch, "start_ai_job", AsyncMock(side_effect=AIJobConflict("job status is failed"))
    )

    with pytest.raises(HTTPException) as exc:
        await webhooks.analysis_context_webhook("lead-1", 500, JOB_ID, _claims())

    assert exc.value.status_code == 409
    assert "ya finalizado (estado failed)" in exc.value.detail

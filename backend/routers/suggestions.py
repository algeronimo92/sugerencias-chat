from fastapi import APIRouter, HTTPException
from models.schemas import AnalysisRequest, SuggestionRequest, SuggestionResponse, SuggestionStatus
from services.db_service import (
    cache_suggestion_if_current,
    get_cached_suggestion,
    get_suggestion_status,
)
from services.n8n_service import call_n8n, call_n8n_analyst
from services.ai_context import fetch_context_revision
from services.ai_job_tokens import issue_ai_job_token
from services.ai_jobs import AIJobConflict, create_ai_job, finish_ai_job, get_ai_job
from tenancy.context import get_current_tenant

import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/suggestions", tags=["suggestions"])


@router.post("/analyze")
async def analyze_lead_on_demand(body: AnalysisRequest):
    """Run the analyst only after an authenticated user asks for it."""

    context_revision = await fetch_context_revision(body.chat_id)
    if context_revision is None:
        raise HTTPException(status_code=404, detail="Lead no encontrado")
    if get_current_tenant() is None:
        raise HTTPException(status_code=503, detail="El contexto tenant es obligatorio para analizar")
    try:
        job, tenant = await create_ai_job(
            "analyst",
            body.chat_id,
            chat_id=body.chat_id,
            context_revision=context_revision,
            request_metadata={"source": "user_request"},
        )
        tenant_token = issue_ai_job_token(
            tenant.organization_id, job.id, "analyst", job.expires_at
        )
        await call_n8n_analyst(
            body.chat_id,
            job_id=job.id,
            context_revision=context_revision,
            tenant_context_token=tenant_token,
        )
    except AIJobConflict as exc:
        raise HTTPException(status_code=503, detail="No se pudo crear el job IA") from exc
    except Exception as exc:
        if "job" in locals():
            await finish_ai_job(job.id, status="failed", error="n8n_call_failed")
        logger.exception("Error llamando al analista para el chat %s", body.chat_id)
        raise HTTPException(status_code=502, detail="Error llamando al workflow analista") from exc

    persisted = await get_ai_job(job.id)
    if persisted is None:
        raise HTTPException(status_code=502, detail="El job IA no pudo verificarse")
    if persisted.status != "applied":
        await finish_ai_job(job.id, status="failed", error="workflow_did_not_apply")
        raise HTTPException(status_code=502, detail="El analista no aplico un resultado validado")
    return persisted.result or {"status": "ok", "job_id": job.id, "applied": True}


@router.get("/{chat_id}", response_model=SuggestionStatus)
async def read_suggestion_status(chat_id: str):
    """Lectura barata de la sugerencia guardada: nunca genera contenido nuevo.
    El frontend la usa al abrir un chat (mostrar lo ya generado es gratis) y
    al llegar un mensaje del cliente (solo para marcarla como desactualizada)."""
    status = await get_suggestion_status(chat_id)
    if status is None:
        raise HTTPException(status_code=404, detail="Lead no encontrado")
    return SuggestionStatus(**status)


@router.post("", response_model=SuggestionResponse)
async def get_suggestions(body: SuggestionRequest):
    # Con indicación del asesor la sugerencia guardada no sirve: se generó sin
    # tenerla en cuenta, así que siempre se pide una nueva al workflow.
    if not body.force and body.instruction is None:
        cached = await get_cached_suggestion(body.chat_id)
        if cached is not None:
            return SuggestionResponse(**cached)

    context_revision = await fetch_context_revision(body.chat_id)
    if context_revision is None:
        raise HTTPException(status_code=404, detail="Lead no encontrado")

    job = None
    tenant_context_token = None
    if get_current_tenant() is not None:
        try:
            job, tenant = await create_ai_job(
                "rag",
                body.chat_id,
                chat_id=body.chat_id,
                context_revision=context_revision,
                request_metadata={
                    "refresh": body.force,
                    "has_instruction": body.instruction is not None,
                },
            )
            tenant_context_token = issue_ai_job_token(
                tenant.organization_id, job.id, "rag", job.expires_at
            )
        except AIJobConflict as exc:
            raise HTTPException(status_code=503, detail="No se pudo crear el job IA") from exc

    try:
        result = await call_n8n(
            body.chat_id,
            body.phone,
            refresh=body.force,
            instruction=body.instruction,
            operation="rag",
            job_id=job.id if job is not None else None,
            context_revision=context_revision,
            tenant_context_token=tenant_context_token,
        )
    except Exception:
        if job is not None:
            await finish_ai_job(job.id, status="failed", error="n8n_call_failed")
        logger.exception("Error llamando a n8n para el chat %s", body.chat_id)
        raise HTTPException(status_code=502, detail="Error llamando al workflow de n8n")

    if job is not None:
        persisted_job = await get_ai_job(job.id)
        completed_steps = (
            (persisted_job.request_metadata or {}).get("completed_steps", [])
            if persisted_job is not None
            else []
        )
        if "context_loaded" not in completed_steps:
            await finish_ai_job(job.id, status="failed", error="scoped_context_not_loaded")
            raise HTTPException(
                status_code=502,
                detail="El workflow RAG no uso el contexto tenant validado",
            )

    cache_status = await cache_suggestion_if_current(
        body.chat_id, result.model_dump(), context_revision
    )
    if cache_status == "missing":
        if job is not None:
            await finish_ai_job(job.id, status="failed", error="lead_not_found")
        raise HTTPException(status_code=404, detail="Lead no encontrado")
    if cache_status == "stale":
        if job is not None:
            await finish_ai_job(job.id, status="failed", error="stale_ai_context")
        raise HTTPException(
            status_code=409,
            detail={"code": "stale_ai_context", "message": "El chat cambio durante la generacion"},
        )

    # RAG only advises the seller. A legacy ``estado`` output remains in the
    # response for compatibility but cannot mutate the lead stage.
    if job is not None:
        await finish_ai_job(job.id, status="succeeded", result=result.model_dump(mode="json"))
    return result

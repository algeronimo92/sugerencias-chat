"""Casos de uso del asistente: analizar un lead y sugerir una respuesta.

Cada pedido es un job firmado: se revisa el plan, la cuota y la plataforma
antes de crearlo, el proveedor de IA (``AiProvider``) lo corre con el token
del job y el resultado solo se acepta si el job lo confirma.
"""

from __future__ import annotations

import logging

from app.core.errors import NotFound
from app.modules.ai.application.ports import (
    AiJobNotStarted,
    AiUnavailable,
    AiWorkflowRejected,
    ai_provider,
    assistant_ports,
)
from app.modules.ai.errors import AssistantError

logger = logging.getLogger(__name__)

_WORKFLOW_FAILED = (
    "El asistente IA no respondió. Intenta de nuevo en unos minutos; "
    "si sigue fallando, avisa al equipo de soporte."
)
_JOB_NOT_STARTED = "No se pudo iniciar la generación. Intenta de nuevo en unos segundos."


class LeadNotFound(NotFound):
    """Lead no encontrado"""

    code = "lead_not_found"


def _workflow_error(exc: Exception) -> AssistantError:
    if isinstance(exc, AiWorkflowRejected):
        return AssistantError(
            503,
            "ai_workflow_rejected",
            "El asistente IA no está disponible: la plataforma no pudo conectarse "
            "con su workflow. Avisa al equipo de soporte.",
        )
    return AssistantError(502, "ai_workflow_failed", _WORKFLOW_FAILED)


async def _require_ai(operation: str) -> None:
    """Plan, configuración de la plataforma, cuota y tenant se revisan antes
    de crear el job: un pedido rechazado no deja rastro ni descuenta del mes."""
    try:
        await assistant_ports().access.ensure_available(operation)
    except AiUnavailable as exc:
        raise AssistantError(exc.status_code, exc.code, exc.message) from exc


async def _start_job(operation: str, chat_id: str, context_revision: str, metadata: dict):
    """Crea el job y su token. Si la firma falla pese a la revisión previa (el
    secreto se quitó entre medio), el job se cierra en vez de quedar colgado."""
    jobs = assistant_ports().jobs
    try:
        job, tenant = await jobs.create(
            operation, chat_id, context_revision=context_revision, request_metadata=metadata,
        )
        try:
            await assistant_ports().access.job_created()
        except Exception:
            # El job ya fue creado; un aviso operativo nunca puede convertir
            # una generación válida en un error para el usuario.
            logger.exception("No se pudo evaluar el aviso de cuota del job %s", job.id)
    except AiJobNotStarted as exc:
        raise AssistantError(503, "ai_job_not_started", _JOB_NOT_STARTED) from exc
    try:
        token = jobs.sign(tenant.organization_id, job.id, operation, job.expires_at)
    except RuntimeError as exc:
        await jobs.finish(job.id, status="failed", error="signing_key_missing")
        logger.error("No se pudo firmar el job IA %s: %s", job.id, exc)
        raise AssistantError(
            503,
            "ai_not_configured",
            "El asistente IA todavía no está disponible: falta completar su "
            "configuración en la plataforma. Avisa al equipo de soporte.",
        ) from exc
    return job, token


async def _context_revision(chat_id: str) -> str:
    revision = await assistant_ports().context.context_revision(chat_id)
    if revision is None:
        raise LeadNotFound()
    return revision


async def analyze_lead(chat_id: str) -> dict:
    """Corre el analista a pedido de un usuario autenticado."""
    context_revision = await _context_revision(chat_id)
    await _require_ai("analyst")
    job, tenant_token = await _start_job("analyst", chat_id, context_revision, {"source": "user_request"})
    try:
        await ai_provider().analyze(
            chat_id, job_id=job.id, context_revision=context_revision, tenant_context_token=tenant_token,
        )
    except Exception as exc:
        await assistant_ports().jobs.finish(job.id, status="failed", error="n8n_call_failed")
        logger.exception("Error llamando al analista para el chat %s", chat_id)
        raise _workflow_error(exc) from exc

    persisted = await assistant_ports().jobs.get(job.id)
    if persisted is None:
        raise AssistantError(502, "ai_workflow_failed", _WORKFLOW_FAILED)
    if persisted.status != "applied":
        await assistant_ports().jobs.finish(job.id, status="failed", error="workflow_did_not_apply")
        raise AssistantError(
            502,
            "ai_workflow_failed",
            "El análisis no se pudo aplicar al lead. Intenta de nuevo en unos minutos.",
        )
    return persisted.result or {"status": "ok", "job_id": job.id, "applied": True}


async def suggest_reply(chat_id: str, phone: str | None, *, force: bool, instruction: str | None):
    # Con indicación del asesor la sugerencia guardada no sirve: se generó sin
    # tenerla en cuenta, así que siempre se pide una nueva al workflow.
    if not force and instruction is None:
        cached = await assistant_ports().context.cached_suggestion(chat_id)
        if cached is not None:
            return cached

    context_revision = await _context_revision(chat_id)
    # Sin tenant no hay job firmado, y el workflow rechaza todo pedido que no
    # traiga uno.
    await _require_ai("rag")
    job, tenant_context_token = await _start_job(
        "rag", chat_id, context_revision, {"refresh": force, "has_instruction": instruction is not None},
    )
    try:
        result = await ai_provider().suggest(
            chat_id,
            phone,
            refresh=force,
            instruction=instruction,
            job_id=job.id,
            context_revision=context_revision,
            tenant_context_token=tenant_context_token,
        )
    except Exception as exc:
        await assistant_ports().jobs.finish(job.id, status="failed", error="n8n_call_failed")
        logger.exception("Error llamando a n8n para el chat %s", chat_id)
        raise _workflow_error(exc) from exc

    persisted_job = await assistant_ports().jobs.get(job.id)
    completed_steps = (
        (persisted_job.request_metadata or {}).get("completed_steps", [])
        if persisted_job is not None
        else []
    )
    if "context_loaded" not in completed_steps:
        await assistant_ports().jobs.finish(job.id, status="failed", error="scoped_context_not_loaded")
        # El workflow respondió sin pasar por /rag-context: la respuesta no
        # está atada a los datos de este negocio y se descarta.
        raise AssistantError(
            502,
            "ai_workflow_misconfigured",
            "El asistente IA respondió sin usar los datos de tu negocio y se "
            "descartó la respuesta. Avisa al equipo de soporte.",
        )

    cache_status = await assistant_ports().context.cache_suggestion_if_current(
        chat_id, result.model_dump(), context_revision,
    )
    if cache_status == "missing":
        await assistant_ports().jobs.finish(job.id, status="failed", error="lead_not_found")
        raise LeadNotFound()
    if cache_status == "stale":
        await assistant_ports().jobs.finish(job.id, status="failed", error="stale_ai_context")
        raise AssistantError(409, "stale_ai_context", "El chat cambio durante la generacion")

    # La sugerencia solo aconseja al vendedor: un ``estado`` heredado en la
    # respuesta se conserva por compatibilidad pero nunca mueve la etapa.
    await assistant_ports().jobs.finish(job.id, status="succeeded", result=result.model_dump(mode="json"))
    return result

import httpx
from fastapi import APIRouter, HTTPException
from models.schemas import AnalysisRequest, SuggestionRequest, SuggestionResponse, SuggestionStatus
from services.db_service import (
    cache_suggestion_if_current,
    get_cached_suggestion,
    get_suggestion_status,
)
from services.n8n_service import call_n8n, call_n8n_analyst
from services.ai_access import (
    AIUnavailableError,
    ensure_ai_available,
    notify_ai_job_created,
    usage_summary,
)
from services.ai_context import fetch_context_revision
from services.ai_job_tokens import issue_ai_job_token
from services.ai_jobs import AIJobConflict, create_ai_job, finish_ai_job, get_ai_job
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/suggestions", tags=["suggestions"])


def _ai_error(status_code: int, code: str, message: str) -> HTTPException:
    """Error del asistente para el vendedor: ``message`` se muestra tal cual y
    ``code`` le dice a la UI si tiene sentido ofrecer reintentar."""
    return HTTPException(status_code=status_code, detail={"code": code, "message": message})


_WORKFLOW_FAILED = (
    "El asistente IA no respondió. Intenta de nuevo en unos minutos; "
    "si sigue fallando, avisa al equipo de soporte."
)
_JOB_NOT_STARTED = "No se pudo iniciar la generación. Intenta de nuevo en unos segundos."
# n8n rechazó la credencial (401/403) o el webhook no existe/no está activo
# (404): es configuración de la plataforma y reintentar no lo arregla.
_WORKFLOW_REJECTED_STATUSES = frozenset({401, 403, 404})


def _workflow_error(exc: Exception) -> HTTPException:
    if (
        isinstance(exc, httpx.HTTPStatusError)
        and exc.response.status_code in _WORKFLOW_REJECTED_STATUSES
    ):
        return _ai_error(
            503,
            "ai_workflow_rejected",
            "El asistente IA no está disponible: la plataforma no pudo conectarse "
            "con su workflow. Avisa al equipo de soporte.",
        )
    return _ai_error(502, "ai_workflow_failed", _WORKFLOW_FAILED)


async def _require_ai(operation: str) -> None:
    """Plan, configuración de la plataforma, cuota y tenant se revisan antes
    de crear el job: un pedido rechazado no deja rastro ni descuenta del mes."""
    try:
        await ensure_ai_available(operation)
    except AIUnavailableError as exc:
        raise _ai_error(exc.status_code, exc.code, exc.message) from exc


async def _start_job(operation: str, chat_id: str, context_revision: str, metadata: dict):
    """Crea el job y su token. Si la firma falla pese a la revisión previa (el
    secreto se quitó entre medio), el job se cierra en vez de quedar colgado."""
    try:
        job, tenant = await create_ai_job(
            operation,
            chat_id,
            chat_id=chat_id,
            context_revision=context_revision,
            request_metadata=metadata,
        )
        try:
            await notify_ai_job_created()
        except Exception:
            # El job ya fue creado; un aviso operativo nunca puede convertir
            # una generación válida en un error para el usuario.
            logger.exception("No se pudo evaluar el aviso de cuota del job %s", job.id)
    except AIJobConflict as exc:
        raise _ai_error(503, "ai_job_not_started", _JOB_NOT_STARTED) from exc
    try:
        token = issue_ai_job_token(tenant.organization_id, job.id, operation, job.expires_at)
    except RuntimeError as exc:
        await finish_ai_job(job.id, status="failed", error="signing_key_missing")
        logger.error("No se pudo firmar el job IA %s: %s", job.id, exc)
        raise _ai_error(
            503,
            "ai_not_configured",
            "El asistente IA todavía no está disponible: falta completar su "
            "configuración en la plataforma. Avisa al equipo de soporte.",
        ) from exc
    return job, token


@router.get("/usage")
async def read_ai_usage():
    """Si el asistente está habilitado y cuánto queda de la cuota del mes."""
    return await usage_summary()


@router.post("/analyze")
async def analyze_lead_on_demand(body: AnalysisRequest):
    """Run the analyst only after an authenticated user asks for it."""

    context_revision = await fetch_context_revision(body.chat_id)
    if context_revision is None:
        raise HTTPException(status_code=404, detail="Lead no encontrado")
    await _require_ai("analyst")
    job, tenant_token = await _start_job(
        "analyst", body.chat_id, context_revision, {"source": "user_request"}
    )
    try:
        await call_n8n_analyst(
            body.chat_id,
            job_id=job.id,
            context_revision=context_revision,
            tenant_context_token=tenant_token,
        )
    except Exception as exc:
        await finish_ai_job(job.id, status="failed", error="n8n_call_failed")
        logger.exception("Error llamando al analista para el chat %s", body.chat_id)
        raise _workflow_error(exc) from exc

    persisted = await get_ai_job(job.id)
    if persisted is None:
        raise _ai_error(502, "ai_workflow_failed", _WORKFLOW_FAILED)
    if persisted.status != "applied":
        await finish_ai_job(job.id, status="failed", error="workflow_did_not_apply")
        raise _ai_error(
            502,
            "ai_workflow_failed",
            "El análisis no se pudo aplicar al lead. Intenta de nuevo en unos minutos.",
        )
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

    # Sin tenant no hay job firmado, y el workflow rechaza todo pedido que no
    # traiga uno: la llamada anónima de la instalación single-tenant ya no
    # tiene contraparte.
    await _require_ai("rag")
    job, tenant_context_token = await _start_job(
        "rag",
        body.chat_id,
        context_revision,
        {"refresh": body.force, "has_instruction": body.instruction is not None},
    )

    try:
        result = await call_n8n(
            body.chat_id,
            body.phone,
            refresh=body.force,
            instruction=body.instruction,
            operation="rag",
            job_id=job.id,
            context_revision=context_revision,
            tenant_context_token=tenant_context_token,
        )
    except Exception as exc:
        await finish_ai_job(job.id, status="failed", error="n8n_call_failed")
        logger.exception("Error llamando a n8n para el chat %s", body.chat_id)
        raise _workflow_error(exc) from exc

    persisted_job = await get_ai_job(job.id)
    completed_steps = (
        (persisted_job.request_metadata or {}).get("completed_steps", [])
        if persisted_job is not None
        else []
    )
    if "context_loaded" not in completed_steps:
        await finish_ai_job(job.id, status="failed", error="scoped_context_not_loaded")
        # El workflow respondió sin pasar por /rag-context: la respuesta no
        # está atada a los datos de este negocio y se descarta.
        raise _ai_error(
            502,
            "ai_workflow_misconfigured",
            "El asistente IA respondió sin usar los datos de tu negocio y se "
            "descartó la respuesta. Avisa al equipo de soporte.",
        )

    cache_status = await cache_suggestion_if_current(
        body.chat_id, result.model_dump(), context_revision
    )
    if cache_status == "missing":
        await finish_ai_job(job.id, status="failed", error="lead_not_found")
        raise HTTPException(status_code=404, detail="Lead no encontrado")
    if cache_status == "stale":
        await finish_ai_job(job.id, status="failed", error="stale_ai_context")
        raise HTTPException(
            status_code=409,
            detail={"code": "stale_ai_context", "message": "El chat cambio durante la generacion"},
        )

    # RAG only advises the seller. A legacy ``estado`` output remains in the
    # response for compatibility but cannot mutate the lead stage.
    await finish_ai_job(job.id, status="succeeded", result=result.model_dump(mode="json"))
    return result

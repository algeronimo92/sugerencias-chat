from fastapi import Depends, Header, HTTPException, Query

from app.integrations.n8n.common import webhooks_router
from app.modules.ai.ports.ai_assistant_service import (fetch_tenant_config)
from app.modules.ai.ports.ai_context import (fetch_analysis_context)
from app.modules.ai.ports.ai_job_tokens import (AIJobClaims, require_ai_job_context)
from app.modules.ai.ports.ai_jobs import (AIJobConflict, AIJobExpired, AIJobNotFound, finish_ai_job, record_ai_job_step, start_ai_job)
from app.modules.leads.ports.stages import (list_stages_for_ai)


router = webhooks_router()


def _raise_job_http_error(exc: Exception) -> None:
    if isinstance(exc, AIJobNotFound):
        raise HTTPException(status_code=404, detail="Job IA no encontrado") from exc
    if isinstance(exc, AIJobExpired):
        raise HTTPException(status_code=410, detail="Job IA vencido") from exc
    reason = str(exc)
    if reason.startswith("job status is"):
        # Reintentar una ejecución vieja de n8n reutiliza un job que el
        # backend ya cerró: hay que pedir un análisis nuevo desde el CRM.
        status = reason.removeprefix("job status is ").strip()
        raise HTTPException(
            status_code=409,
            detail=f"Job IA ya finalizado (estado {status}); pide uno nuevo desde el CRM",
        ) from exc
    raise HTTPException(status_code=409, detail="Job IA no coincide con la operacion") from exc


@router.get("/analysis-context")
async def analysis_context_webhook(
    chat_id: str,
    limit: int = Query(default=500, ge=1, le=500),
    x_job_id: str = Header(alias="X-Job-Id"),
    claims: AIJobClaims = Depends(require_ai_job_context),
):
    """Contexto allowlist para un job analyst creado por el backend."""

    if claims.job_id != x_job_id or claims.operation != "analyst":
        raise HTTPException(status_code=403, detail="Job IA fuera de alcance")
    try:
        job = await start_ai_job(
            x_job_id, operation="analyst", resource_id=chat_id
        )
    except (AIJobNotFound, AIJobExpired, AIJobConflict) as exc:
        _raise_job_http_error(exc)

    context = await fetch_analysis_context(chat_id, limit=limit)
    if context is None:
        await finish_ai_job(x_job_id, status="failed", error="lead_not_found")
        raise HTTPException(status_code=404, detail="Lead no encontrado")
    if context["context_revision"] != job.context_revision:
        await finish_ai_job(x_job_id, status="failed", error="stale_ai_context")
        raise HTTPException(
            status_code=409,
            detail={
                "code": "stale_ai_context",
                "current_revision": context["context_revision"],
            },
        )
    await record_ai_job_step(x_job_id, "context_loaded")
    # Las etapas son de cada negocio: el workflow analista es uno solo y solo
    # conoce las válidas (clave, nombre, tipo y criterio) por lo que recibe acá.
    # El perfil del negocio lo usa el prompt igual que en las sugerencias.
    return {
        "operation": "analyst",
        "job_id": x_job_id,
        **context,
        "stages": await list_stages_for_ai(),
        "tenant_config": await fetch_tenant_config(),
    }

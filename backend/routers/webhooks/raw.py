from fastapi import Depends, Header, HTTPException, Query

from services.db_service import (
    fetch_lead_raw,
    fetch_last_wa_message_id,
    fetch_message_by_wa_id,
    fetch_messages_raw,
    list_lead_services,
)
from models.webhook_schemas import RagSearchWebhookBody
from routers.webhooks.common import webhooks_router
from services.ai_context import fetch_analysis_context, fetch_context_revision
from services.ai_job_tokens import AIJobClaims, require_ai_job_context
from services.ai_jobs import (
    AIJobConflict,
    AIJobExpired,
    AIJobNotFound,
    finish_ai_job,
    start_ai_job,
)


router = webhooks_router()


def _raise_job_http_error(exc: Exception) -> None:
    if isinstance(exc, AIJobNotFound):
        raise HTTPException(status_code=404, detail="Job IA no encontrado") from exc
    if isinstance(exc, AIJobExpired):
        raise HTTPException(status_code=410, detail="Job IA vencido") from exc
    raise HTTPException(status_code=409, detail="Job IA no coincide con la operaciÃ³n") from exc


@router.get("/lead-raw")
async def lead_raw_webhook(chat_id: str):
    """Reemplaza los nodos Postgres `get lead1` / `try to get lead`: fila
    cruda de `leads`. `{}` si no existe -el mismo shape que devolvía el nodo
    Postgres con `alwaysOutputData`- para que el chequeo `{{ $json }}` vacío
    de los IF de n8n siga funcionando sin tocarlos."""
    lead = await fetch_lead_raw(chat_id)
    return lead or {}


@router.get("/lead-messages-raw")
async def lead_messages_raw_webhook(chat_id: str, limit: int = 500):
    """Reemplaza al nodo Postgres `get messages` (contexto del copiloto de
    ventas, workflow `sugerencia`): últimos `limit` mensajes de un chat,
    crudos y más recientes primero."""
    return {"messages": await fetch_messages_raw(chat_id, limit=limit)}


@router.get("/message-by-wa-id-raw")
async def message_by_wa_id_raw_webhook(wa_message_id: str):
    """Reemplaza al nodo Postgres `buscar mensaje existente1` (chequeo de
    duplicado antes de insertar un mensaje entrante). `{}` si no existe."""
    message = await fetch_message_by_wa_id(wa_message_id)
    return message or {}


@router.get("/last-message-raw")
async def last_message_raw_webhook(chat_id: str):
    """Reemplaza al nodo Postgres `ultimo mensaje1`: el wa_message_id del
    último mensaje del chat. `{}` si el chat todavía no tiene ninguno."""
    wa_message_id = await fetch_last_wa_message_id(chat_id)
    return {"wa_message_id": wa_message_id} if wa_message_id else {}


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
    return {"operation": "analyst", "job_id": x_job_id, **context}


@router.post("/rag-search")
async def rag_search_webhook(
    body: RagSearchWebhookBody,
    x_job_id: str = Header(alias="X-Job-Id"),
    claims: AIJobClaims = Depends(require_ai_job_context),
):
    """Contrato tenant-scoped para RAG.

    El backend vectorial aislado aÃºn no existe. Fallar con 501 evita que el
    workflow vuelva al vector store Supabase compartido por accidente.
    """

    if claims.job_id != x_job_id or claims.operation != "rag":
        raise HTTPException(status_code=403, detail="Job IA fuera de alcance")
    try:
        job = await start_ai_job(
            x_job_id, operation="rag", context_revision=body.context_revision
        )
    except (AIJobNotFound, AIJobExpired, AIJobConflict) as exc:
        _raise_job_http_error(exc)
    current_revision = await fetch_context_revision(job.chat_id or job.resource_id)
    if current_revision != body.context_revision:
        await finish_ai_job(x_job_id, status="failed", error="stale_ai_context")
        raise HTTPException(status_code=409, detail={"code": "stale_ai_context"})
    await finish_ai_job(x_job_id, status="failed", error="rag_backend_not_configured")
    raise HTTPException(
        status_code=501,
        detail="RAG tenant-scoped no estÃ¡ configurado; el store compartido estÃ¡ deshabilitado",
    )


@router.get("/catalog")
async def ai_catalog_webhook(
    x_job_id: str = Header(alias="X-Job-Id"),
    claims: AIJobClaims = Depends(require_ai_job_context),
):
    """CatÃ¡logo del schema del job; no acepta tenant ni schema en el body."""

    if claims.job_id != x_job_id or claims.operation not in {"rag", "analyst"}:
        raise HTTPException(status_code=403, detail="Job IA fuera de alcance")
    try:
        await start_ai_job(x_job_id, operation=claims.operation)
    except (AIJobNotFound, AIJobExpired, AIJobConflict) as exc:
        _raise_job_http_error(exc)
    services = await list_lead_services()
    return {
        "services": [
            {"id": item["id"], "name": item["name"]}
            for item in services
            if item.get("is_active", True)
        ]
    }

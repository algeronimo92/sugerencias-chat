from fastapi import Depends, Header, HTTPException
from app.modules.leads.public import InvalidLeadStageError
from app.integrations.n8n.webhook_schemas import LeadAnalysisResultWebhookBody
from app.modules.ai.ports.ai_job_tokens import (AIJobClaims, require_ai_job_context)
from app.modules.ai.ports.ai_jobs import (AIContextStale, AIJobConflict, AIJobExpired, AIJobNotFound, apply_analysis_job_atomic, finish_ai_job)
from app.core.events import publish
from app.integrations.n8n.common import webhooks_router
from app.modules.leads.public import LeadChangedOutside


router = webhooks_router()


async def _broadcast_lead_updated(chat_id: str) -> None:
    """Avisa a los paneles abiertos de que el analista reescribió el lead.

    Se avisa aunque la etapa no se mueva: mantenerla es la respuesta más
    frecuente del agente, y sin el aviso un nombre recién deducido de la
    conversación no aparecía en pantalla hasta el siguiente mensaje. Mientras
    el WebSocket está conectado el frontend no hace polling (ver useChats.ts,
    refetchInterval).
    """
    await publish(LeadChangedOutside(lead_id=chat_id))


@router.post("/analysis-jobs/{job_id}/apply")
async def apply_analysis_job_webhook(
    job_id: str,
    body: LeadAnalysisResultWebhookBody,
    x_job_id: str = Header(alias="X-Job-Id"),
    claims: AIJobClaims = Depends(require_ai_job_context),
):
    """Aplica una sola vez el resultado tenant-scoped del analista."""

    if claims.job_id != job_id or x_job_id != job_id or claims.operation != "analyst":
        raise HTTPException(status_code=403, detail="Job IA fuera de alcance")

    patch_fields = body.fields.model_fields_set
    values = body.fields.model_dump(include=patch_fields)
    if "con_especialista" in values and values["con_especialista"] is None:
        await finish_ai_job(job_id, status="failed", error="invalid_patch")
        raise HTTPException(status_code=422, detail="con_especialista no puede ser null")

    # La clave se valida contra las etapas del negocio dentro de la misma
    # transacción que aplica el resultado (ver apply_analysis_job_atomic).
    stage = body.estado or None

    try:
        result = await apply_analysis_job_atomic(
            job_id,
            chat_id=body.chat_id,
            context_revision=body.context_revision,
            values=values,
            stage=stage,
            reasoning=body.razonamiento,
        )
    except InvalidLeadStageError as exc:
        raise HTTPException(status_code=422, detail=f"Estado invalido: {exc}") from exc
    except AIJobNotFound as exc:
        raise HTTPException(status_code=404, detail="Job IA o lead no encontrado") from exc
    except AIJobExpired as exc:
        raise HTTPException(status_code=410, detail="Job IA vencido") from exc
    except AIContextStale as exc:
        raise HTTPException(
            status_code=409,
            detail={"code": "stale_ai_context", "current_revision": exc.current_revision},
        ) from exc
    except AIJobConflict as exc:
        raise HTTPException(status_code=409, detail="Job IA no coincide con el resultado") from exc

    await _broadcast_lead_updated(body.chat_id)
    return result

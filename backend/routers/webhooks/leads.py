from fastapi import HTTPException
from db.models import LeadStage
from services.db_service import ensure_lead_stub, record_lead_touch, update_lead, update_lead_stage
from services.whatsapp_identity_service import lead_id_for_jid
from services.ws_manager import manager
from services.automation_service import notify_automations_scheduled
from models.webhook_schemas import (
    LeadTouchWebhookBody,
    LeadStageWebhookBody,
    EnsureLeadWebhookBody,
    LeadAnalysisWebhookBody,
    LeadInboundActivityWebhookBody,
)
from routers.webhooks.common import _parse_iso_datetime, webhooks_router


router = webhooks_router()


@router.post("/lead-touch")
async def lead_touch_webhook(body: LeadTouchWebhookBody):
    """Llamado por un cron de n8n justo después de mandarle al cliente un
    mensaje de seguimiento (recordatorio de cita, cadencia de nutrición,
    etc.) — incrementa `leads.toques_seguimiento` y actualiza
    `fecha_ultimo_toque`."""
    lead_id = await lead_id_for_jid(body.jid)
    if lead_id is None or not await record_lead_touch(lead_id):
        raise HTTPException(status_code=404, detail="No hay un lead asociado a ese JID")
    await manager.broadcast({"type": "chats_updated", "chat_id": lead_id, "reason": "lead_updated"})
    return {"status": "ok", "chat_id": lead_id}


async def _broadcast_lead_updated(chat_id: str) -> None:
    """Avisa a los paneles abiertos de que el lead cambió por fuera de la app.

    El agente analista de n8n escribe nombre, teléfono, notas y
    servicio_interes con un UPDATE directo a PostgreSQL, y llama a este webhook
    inmediatamente después. Sin este aviso el CRM se queda con los datos viejos
    hasta que otra cosa provoque un refresco: mientras el WebSocket está
    conectado el frontend no hace polling (ver useChats.ts, refetchInterval).
    """
    await manager.broadcast(
        {"type": "chats_updated", "chat_id": chat_id, "reason": "lead_updated"}
    )


@router.post("/lead-stage")
async def lead_stage_webhook(
    body: LeadStageWebhookBody,
):
    """Llamado por n8n cuando el agente analista termina de analizar el lead.

    Reemplaza el UPDATE directo a ``leads.estado`` que hacía el workflow: al
    pasar por acá el cambio queda auditado en ``lead_activity`` (con el
    razonamiento del agente y la foto del último mensaje del cliente), se
    notifica a los paneles abiertos y se disparan las automatizaciones de
    cambio de etapa.

    Se avisa a los paneles incluso cuando la etapa no se mueve: el agente
    también reescribe el resto de los campos del lead, y mantener la etapa es
    su respuesta más frecuente. Sin ese aviso, un nombre recién deducido de la
    conversación no aparecía en pantalla hasta el siguiente mensaje.
    """
    if body.estado is None:
        await _broadcast_lead_updated(body.chat_id)
        return {"status": "ok", "changed": False, "stage": None}

    try:
        stage = LeadStage(body.estado)
    except ValueError:
        raise HTTPException(
            status_code=422,
            detail=f"Estado inválido: {body.estado!r}. Válidos: {[s.value for s in LeadStage]}",
        )

    metadata = {"reason": body.razonamiento} if body.razonamiento else None
    result = await update_lead_stage(
        body.chat_id, stage, actor_type="agent", metadata=metadata, include_chat=False
    )
    if result is None:
        raise HTTPException(status_code=404, detail="Lead no encontrado")

    if result["changed"]:
        await manager.broadcast(
            {
                "type": "chats_updated",
                "chat_id": body.chat_id,
                "reason": "stage_changed",
                "lead_stage_updated": {"chat_id": body.chat_id, "stage": stage.value},
            }
        )
        await notify_automations_scheduled(result.get("automations_scheduled", 0))
    else:
        # La etapa no se movió, pero el analista sí tocó el resto del lead.
        await _broadcast_lead_updated(body.chat_id)

    return {"status": "ok", "changed": result["changed"], "stage": stage.value}


@router.post("/ensure-lead")
async def ensure_lead_webhook(body: EnsureLeadWebhookBody):
    """Reemplaza al nodo Postgres `create lead`: alta idempotente de un lead
    mínimo cuando llega un mensaje de un chat todavía no registrado."""
    return await ensure_lead_stub(
        body.chat_id, _parse_iso_datetime(body.ultimo_mensaje_at), body.origen
    )


@router.post("/lead-analysis")
async def lead_analysis_webhook(body: LeadAnalysisWebhookBody):
    """Reemplaza el UPDATE directo del nodo `update lead`: deja el cambio
    auditado en lead_activity y avisa a los paneles abiertos."""
    values = body.model_dump(exclude={"chat_id"}, exclude_none=True)
    if not values:
        return {"status": "ok", "changed": False}
    lead = await update_lead(body.chat_id, values, actor_type="agent")
    if lead is None:
        raise HTTPException(status_code=404, detail="Lead no encontrado")
    await _broadcast_lead_updated(body.chat_id)
    return {"status": "ok", "changed": True}


@router.post("/lead-inbound-activity")
async def lead_inbound_activity_webhook(body: LeadInboundActivityWebhookBody):
    """Reemplaza el UPDATE directo del nodo `update lead4`."""
    values: dict = {}
    if body.ultimo_emisor is not None:
        values["ultimo_emisor"] = body.ultimo_emisor
    timestamp = _parse_iso_datetime(body.ultimo_mensaje_at)
    if timestamp is not None:
        values["ultimo_mensaje_at"] = timestamp
    if not values:
        return {"status": "ok", "changed": False}
    if await update_lead(body.chat_id, values, actor_type="system") is None:
        raise HTTPException(status_code=404, detail="Lead no encontrado")
    return {"status": "ok", "changed": True}

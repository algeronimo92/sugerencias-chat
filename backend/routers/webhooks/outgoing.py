import base64
import binascii

from services.db_service import attach_outgoing_analysis, reconcile_outgoing_message
from services.productivity_service import complete_assigned_seller_reply_tasks
from services.ws_manager import manager
from models.webhook_schemas import OutgoingAnalysisWebhookBody, OutgoingWebhookBody
from routers.webhooks.common import webhooks_router


router = webhooks_router()


# Evolution usa ``unknown`` para mensajes creados mediante su API. Los que una
# persona escribe desde un dispositivo vinculado conservan la plataforma real.
HUMAN_WHATSAPP_SOURCES = frozenset({"android", "ios", "web"})


@router.post("/analysis")
async def outgoing_analysis_webhook(
    body: OutgoingAnalysisWebhookBody,
):
    """Llamado por n8n con el análisis IA de una media SALIENTE del vendedor.

    La app guarda la media que el vendedor manda pero no la analiza; n8n corre
    el análisis sobre el eco y lo manda acá para fusionarlo en esa misma fila
    (en vez de duplicar el mensaje). Si no encuentra la fila —media mandada
    desde el teléfono— la inserta."""
    result = await attach_outgoing_analysis(
        body.chat_id,
        body.message_type,
        body.analysis,
        wa_message_id=body.wa_message_id,
        content=body.content,
        media_url=body.media_url,
    )
    await manager.broadcast(
        {"type": "chats_updated", "chat_id": body.chat_id, "reason": "analysis"}
    )
    return {"status": "ok", **result}


@router.post("/outgoing")
async def outgoing_webhook(
    body: OutgoingWebhookBody,
):
    """Llamado por n8n con un mensaje SALIENTE (fromMe) que no lleva análisis.

    Reconcilia: descarta el eco de nuestros propios envíos (ya guardados por la
    app) pero conserva los salientes externos —auto-reply de Kommo, mensajes
    escritos desde el teléfono— que solo llegan por acá."""
    source = (body.source or "").strip().lower()
    human_reply = source in HUMAN_WHATSAPP_SOURCES
    message_payload = body.payload
    if source:
        message_payload = {**(message_payload or {}), "source": source}

    message_secret: bytes | None = None
    if body.message_secret:
        try:
            message_secret = base64.b64decode(body.message_secret, validate=True)
        except (binascii.Error, ValueError):
            message_secret = None

    result = await reconcile_outgoing_message(
        body.chat_id,
        body.message_type,
        body.content,
        wa_message_id=body.wa_message_id,
        media_url=body.media_url,
        payload=message_payload,
        human_reply=human_reply,
        message_secret=message_secret,
    )
    completed_tasks = (
        await complete_assigned_seller_reply_tasks(body.chat_id)
        if human_reply
        else 0
    )
    # Solo avisamos cuando se insertó algo nuevo (un saliente externo); el eco de
    # nuestros propios envíos ya está en pantalla.
    if not result["matched"]:
        await manager.broadcast(
            {"type": "chats_updated", "chat_id": body.chat_id, "reason": "outbound_message"}
        )
    if completed_tasks:
        await manager.broadcast({"type": "tasks_updated"})
    return {"status": "ok", **result}

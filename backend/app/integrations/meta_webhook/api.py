"""Webhook de Meta WhatsApp Cloud API, conectado directo al backend.

No usa el token compartido de las integraciones: Meta no lo manda. La
suscripción se valida con el verify token y cada POST con la firma HMAC del
cuerpo crudo (``X-Hub-Signature-256``), las dos contra la configuración de la
plataforma. El negocio se resuelve después, por evento, desde el inbox.

Si n8n queda delante, tiene que reenviar el cuerpo y la firma sin tocarlos:
cualquier cambio en el cuerpo invalida la firma.
"""

import json
import logging

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import PlainTextResponse

from app.integrations.meta_webhook import metrics
from app.integrations.meta_webhook.inbox import split_changes, store_changes
from app.integrations.meta_webhook.worker import notify_new_events
from app.integrations.meta_webhook.auth import verify_challenge, verify_signature

router = APIRouter(prefix="/api/webhooks/meta", tags=["meta-webhook"])
logger = logging.getLogger(__name__)


@router.get("/whatsapp", response_class=PlainTextResponse)
async def verify_subscription(
    mode: str | None = Query(default=None, alias="hub.mode"),
    verify_token: str | None = Query(default=None, alias="hub.verify_token"),
    challenge: str | None = Query(default=None, alias="hub.challenge"),
) -> str:
    if not await verify_challenge(mode, verify_token):
        raise HTTPException(status_code=403, detail="Verify token de Meta inválido")
    return challenge or ""


@router.post("/whatsapp")
async def receive_webhook(request: Request) -> dict:
    """Guarda cada ``change`` crudo y responde; el procesamiento es asíncrono.

    Meta reintenta si no recibe 200 a tiempo, así que acá solo se verifica,
    se persiste y se despierta al worker. Un reintento de algo ya guardado se
    cuenta como duplicado y no se vuelve a procesar.
    """
    raw_body = await request.body()
    signature = request.headers.get("x-hub-signature-256")
    if not await verify_signature(raw_body, signature):
        metrics.webhook_signature_rejected.inc()
        raise HTTPException(status_code=401, detail="Firma de Meta inválida")
    try:
        body = json.loads(raw_body)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Cuerpo JSON inválido") from exc
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Cuerpo JSON inválido")

    accepted, duplicates = await store_changes(split_changes(body))
    if duplicates:
        metrics.webhook_duplicate_changes.inc(duplicates)
    if accepted:
        await notify_new_events()
    return {"received": len(accepted), "duplicates": duplicates}

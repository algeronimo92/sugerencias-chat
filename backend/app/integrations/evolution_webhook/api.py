import hmac

from fastapi import APIRouter, Header, HTTPException, Request

from app.integrations.evolution_webhook.inbox import store_event
from app.integrations.evolution_webhook.worker import notify_new_events
from app.modules.platform.ports.platform_settings import platform_setting

router = APIRouter(prefix="/api/webhooks/evolution", tags=["evolution-webhook"])


@router.post("/whatsapp")
async def receive_evolution_webhook(
    request: Request, authorization: str | None = Header(default=None)
) -> dict:
    token = await platform_setting("evolution_webhook_token")
    expected = f"Bearer {token}"
    if not token or not authorization or not hmac.compare_digest(
        authorization, expected
    ):
        raise HTTPException(401, "Token de Evolution inválido")
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(400, "Cuerpo JSON inválido")
    event_id, duplicate = await store_event(payload)
    if event_id:
        await notify_new_events()
    return {"received": not duplicate, "duplicate": duplicate}

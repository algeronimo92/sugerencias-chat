from fastapi import APIRouter, Header, HTTPException
from services.settings_service import get_effective
from services.ws_manager import manager

router = APIRouter(prefix="/api/webhooks", tags=["webhooks"])


@router.post("/messages")
async def new_message_webhook(x_webhook_token: str | None = Header(default=None)):
    """Llamado por n8n justo después de guardar un mensaje nuevo en la DB."""
    expected_token = await get_effective("inbound_webhook_token")
    if expected_token and x_webhook_token != expected_token:
        raise HTTPException(status_code=401, detail="Token inválido")

    await manager.broadcast({"type": "chats_updated"})
    return {"status": "ok"}

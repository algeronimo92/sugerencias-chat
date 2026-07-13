from fastapi import APIRouter, Header, HTTPException
from models.schemas import MessageStatusUpdate
from services.db_service import fetch_latest_message, update_message_status
from services.settings_service import get_effective
from services.ws_manager import manager

router = APIRouter(prefix="/api/webhooks", tags=["webhooks"])


async def _check_token(x_webhook_token: str | None) -> None:
    expected_token = await get_effective("inbound_webhook_token")
    if expected_token and x_webhook_token != expected_token:
        raise HTTPException(status_code=401, detail="Token inválido")


@router.post("/messages")
async def new_message_webhook(x_webhook_token: str | None = Header(default=None)):
    """Llamado por n8n justo después de guardar un mensaje nuevo en la DB."""
    await _check_token(x_webhook_token)

    payload = {"type": "chats_updated"}
    latest = await fetch_latest_message()
    if latest is not None:
        payload["latest_message"] = latest

    await manager.broadcast(payload)
    return {"status": "ok"}


@router.post("/message-status")
async def message_status_webhook(body: MessageStatusUpdate, x_webhook_token: str | None = Header(default=None)):
    """Llamado por n8n cuando Evolution API reporta un cambio de estado
    (SERVER_ACK/DELIVERY_ACK/READ/PLAYED) de un mensaje ya enviado."""
    await _check_token(x_webhook_token)

    updated = await update_message_status(body.wa_message_id, body.status)
    if updated is not None:
        await manager.broadcast({"type": "chats_updated"})

    return {"status": "ok", "matched": updated is not None}

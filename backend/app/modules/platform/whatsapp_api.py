from fastapi import APIRouter

from app.integrations.meta import client as meta_service
from app.modules.platform.schemas import WhatsappStatusItem

router = APIRouter(prefix="/api/whatsapp", tags=["whatsapp"])


@router.get("/status", response_model=WhatsappStatusItem)
async def whatsapp_status():
    """Si el número de Meta Cloud API está conectado. No hay ciclo de QR ni
    desconexión: el número queda vinculado por el Embedded Signup."""
    if await meta_service.is_configured():
        return {"state": "open", "instance": None}
    return {"state": "not_configured", "instance": None}

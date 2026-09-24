from fastapi import APIRouter

from services import meta_service

router = APIRouter(prefix="/api/whatsapp", tags=["whatsapp"])


@router.get("/status")
async def whatsapp_status():
    """Si el número de Meta Cloud API está conectado. No hay ciclo de QR ni
    desconexión: el número queda vinculado por el Embedded Signup."""
    if await meta_service.is_configured():
        return {"state": "open", "instance": None}
    return {"state": "not_configured", "instance": None}

from fastapi import APIRouter, HTTPException

from services import meta_service
from services.evolution_service import (
    EvolutionApiError,
    connect_instance,
    get_connection_state,
    is_configured,
    logout_instance,
)

router = APIRouter(prefix="/api/whatsapp", tags=["whatsapp"])

_NOT_CONFIGURED = (
    "Completá la configuración de Evolution API (URL, API key e instancia) "
    "en la pestaña Claves antes de conectar."
)


@router.get("/status")
async def whatsapp_status():
    # Meta Cloud API es el proveedor actual: si está configurado el número ya
    # está vinculado y no hay instancia que sondear (no existe el ciclo de
    # QR/desconexión de Evolution). El camino de abajo queda para las
    # instalaciones que todavía siguen en Evolution.
    if await meta_service.is_configured():
        return {"state": "open", "instance": None}
    # Sin credenciales no hay a quién preguntarle: se responde un estado
    # propio (no un error) para que la UI muestre el aviso de configuración.
    if not await is_configured():
        return {"state": "not_configured", "instance": None}
    try:
        return await get_connection_state()
    except EvolutionApiError as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.post("/connect")
async def whatsapp_connect():
    if not await is_configured():
        raise HTTPException(status_code=400, detail=_NOT_CONFIGURED)
    try:
        return await connect_instance()
    except EvolutionApiError as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.post("/logout")
async def whatsapp_logout():
    if not await is_configured():
        raise HTTPException(status_code=400, detail=_NOT_CONFIGURED)
    try:
        return await logout_instance()
    except EvolutionApiError as e:
        raise HTTPException(status_code=502, detail=str(e))

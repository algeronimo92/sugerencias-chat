import base64
import re

import httpx
from fastapi import APIRouter, Depends, HTTPException

from db.models import User
from models.schemas import AppointmentCreate
from routers.media import normalize_media_content_type
from services.auth_service import get_current_user
from services.settings_service import get_effective

router = APIRouter(prefix="/api/appointments", tags=["appointments"])

# Mismas reglas que el nodo "Preparar cita y mensajes" del workflow de n8n
# (FORM-NUEVAS-CITAS.json): esto solo adelanta el error con un 400 rápido, la
# validación real sigue viviendo ahí.
ALLOWED_VENDEDORES = {"Antonella", "Grecia"}
ALLOWED_COMPROBANTE_TYPES = {"image/jpeg", "image/png", "application/pdf"}
MAX_COMPROBANTE_BYTES = 10 * 1024 * 1024
REQUEST_TIMEOUT_SECONDS = 60.0


def _normalize_phone(raw: str) -> str:
    phone = re.sub(r"\D", "", raw)
    if len(phone) == 11 and phone.startswith("51"):
        phone = phone[2:]
    return phone


@router.post("")
async def post_appointment(body: AppointmentCreate, user: User = Depends(get_current_user)):
    phone = _normalize_phone(body.telefono)
    if not re.fullmatch(r"9\d{8}", phone):
        raise HTTPException(400, "Teléfono peruano inválido")
    if body.vendedor not in ALLOWED_VENDEDORES:
        raise HTTPException(400, "Vendedor inválido")
    if body.test_mode and user.role != "admin":
        raise HTTPException(403, "Solo un administrador puede enviar en modo prueba")

    setting_key = "n8n_citas_webhook_test_url" if body.test_mode else "n8n_citas_webhook_url"
    webhook_url = await get_effective(setting_key)
    if not webhook_url:
        detail = " de prueba" if body.test_mode else ""
        raise HTTPException(503, f"n8n no está configurado para citas (falta la URL del webhook{detail})")

    data = {
        "Nombre completo": body.nombre_completo,
        "DNI": body.dni,
        "Telefono": body.telefono,
        "Tratamiento": body.tratamiento,
        "Detalle": body.detalle,
        "Fecha": body.fecha,
        "Hora": body.hora,
        "Vendedor": body.vendedor,
        "Adelanto": str(body.adelanto),
        "formMode": "test" if body.test_mode else "production",
    }

    files = None
    if body.comprobante is not None:
        content_type = normalize_media_content_type(body.comprobante.content_type, body.comprobante.filename)
        if content_type not in ALLOWED_COMPROBANTE_TYPES:
            raise HTTPException(400, "El comprobante debe ser una imagen JPG/PNG o un PDF")
        try:
            raw = base64.b64decode(body.comprobante.data_base64, validate=True)
        except Exception:
            raise HTTPException(400, "El comprobante no es un archivo válido")
        if not raw:
            raise HTTPException(400, "El comprobante está vacío")
        if len(raw) > MAX_COMPROBANTE_BYTES:
            raise HTTPException(413, "El comprobante supera el máximo de 10 MB")
        files = {"Comprobante": (body.comprobante.filename, raw, content_type)}

    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
            response = await client.post(webhook_url, data=data, files=files)
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"No se pudo contactar a n8n: {exc}")

    if response.status_code >= 400:
        message = response.text
        try:
            payload = response.json()
            message = payload.get("description") or payload.get("message") or message
        except ValueError:
            pass
        raise HTTPException(502, message or "n8n rechazó la cita")

    try:
        payload = response.json()
    except ValueError:
        return {"success": True, "message": "Cita enviada"}
    # n8n responde con un array de items cuando el último nodo produce uno
    # solo (nuestro caso: "Resumen creación y envíos" o el passthrough de
    # "Fin - cita duplicada").
    if isinstance(payload, list):
        return payload[0] if payload else {"success": True, "message": "Cita enviada"}
    return payload

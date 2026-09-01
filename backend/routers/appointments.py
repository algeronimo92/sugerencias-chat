import base64
import logging
import re

import httpx
from fastapi import APIRouter, Depends, HTTPException

from db.models import User
from domain_types import NotificationType
from models.schemas import AppointmentCreate, AppointmentItem
from routers.media import normalize_media_content_type
from services.appointment_service import create_appointment_record, list_appointments
from services.auth_service import get_current_user
from services.issue_report_service import list_active_admin_ids
from services.notification_service import create_system_notification
from services.push_service import send_push_to_user
from services.settings_service import get_effective
from services.ws_manager import manager

router = APIRouter(prefix="/api/appointments", tags=["appointments"])
logger = logging.getLogger(__name__)

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


@router.get("", response_model=list[AppointmentItem])
async def get_appointments(_user: User = Depends(get_current_user)):
    return await list_appointments()


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

    async def record(status: str, n8n_status: str | None, message: str | None, event_link: str | None) -> dict:
        return await create_appointment_record(
            created_by_user_id=user.id,
            nombre_completo=body.nombre_completo,
            dni=body.dni,
            telefono=body.telefono,
            tratamiento=body.tratamiento,
            detalle=body.detalle,
            fecha=body.fecha,
            hora=body.hora,
            vendedor=body.vendedor,
            adelanto=body.adelanto,
            comprobante_filename=body.comprobante.filename if body.comprobante else None,
            test_mode=body.test_mode,
            status=status,
            n8n_status=n8n_status,
            message=message,
            event_link=event_link,
        )

    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
            response = await client.post(webhook_url, data=data, files=files)
    except httpx.HTTPError as exc:
        message = f"No se pudo contactar a n8n: {exc}"
        await record("error", None, message, None)
        raise HTTPException(502, message)

    if response.status_code >= 400:
        message = response.text
        try:
            error_payload = response.json()
            message = error_payload.get("description") or error_payload.get("message") or message
        except ValueError:
            pass
        message = message or "n8n rechazó la cita"
        await record("error", None, message, None)
        raise HTTPException(502, message)

    try:
        payload = response.json()
    except ValueError:
        payload = {"success": True, "message": "Cita enviada"}
    # n8n responde con un array de items cuando el último nodo produce uno
    # solo (nuestro caso: "Resumen creación y envíos" o el passthrough de
    # "Fin - cita duplicada").
    if isinstance(payload, list):
        payload = payload[0] if payload else {"success": True, "message": "Cita enviada"}

    if payload.get("citaDuplicada"):
        status = "duplicate"
    elif payload.get("success") is False:
        status = "created_with_errors"
    else:
        status = "created"
    appointment = await record(status, payload.get("status"), payload.get("message"), payload.get("eventLink"))

    if status in {"created", "created_with_errors"} and not body.test_mode:
        await _notify_new_appointment(appointment, user)

    return payload


async def _notify_new_appointment(appointment: dict, user: User) -> None:
    title = f"Nueva cita: {appointment['nombre_completo']}"
    text = f"{appointment['tratamiento']} · {appointment['fecha']} {appointment['hora']}"
    try:
        admin_ids = await list_active_admin_ids()
        recipient_ids = {user.id, *admin_ids}
        for recipient_id in recipient_ids:
            notification = await create_system_notification(
                recipient_id,
                NotificationType.APPOINTMENT,
                title,
                text,
                source_id=str(appointment["id"]),
                metadata={"appointment_id": appointment["id"]},
            )
            await manager.send_to_user(recipient_id, {
                "type": "notification_created",
                "notification": notification,
            })
            await send_push_to_user(
                recipient_id,
                title,
                text,
                "/citas/nueva",
                tag=f"appointment-{appointment['id']}",
            )
    except Exception:
        # La cita ya quedó persistida; un aviso fallido no puede convertir ese
        # éxito en un 500 que invite a reenviar el formulario.
        logger.exception("No se pudo avisar de la nueva cita %s", appointment["id"])

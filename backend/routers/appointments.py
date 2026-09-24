import base64
import json
import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException

from db.models import User
from domain_types import NotificationType
from models.schemas import AppointmentCreate, AppointmentItem
from services.appointment_service import create_appointment_record, get_appointment, list_appointments, update_appointment_integrations
from services.auth_service import get_current_user
from services.custom_fields import CustomFieldError, list_definitions, normalize_values
from services.db_service import list_active_sellers
from services.google_calendar import create_google_event
from services.issue_report_service import list_active_admin_ids
from services.media_upload import normalize_media_content_type
from services.n8n_service import post_form
from services.notification_service import create_system_notification
from services.phone_utils import PhoneValidationError, effective_country_code, normalize_phone
from services.push_service import send_push_to_user
from services.settings_service import get_effective
from services.ws_manager import manager

router = APIRouter(prefix="/api/appointments", tags=["appointments"])
logger = logging.getLogger(__name__)

ALLOWED_COMPROBANTE_TYPES = {"image/jpeg", "image/png", "application/pdf"}
MAX_COMPROBANTE_BYTES = 10 * 1024 * 1024
REQUEST_TIMEOUT_SECONDS = 60.0


async def _active_seller_names() -> set[str]:
    return {str(seller["name"]).strip() for seller in await list_active_sellers()}


@router.get("", response_model=list[AppointmentItem])
async def get_appointments(_user: User = Depends(get_current_user)):
    return await list_appointments()


@router.post("/{appointment_id}/sync-calendar", response_model=AppointmentItem)
async def sync_appointment_calendar(
    appointment_id: int,
    _user: User = Depends(get_current_user),
):
    appointment = await get_appointment(appointment_id)
    if appointment is None:
        raise HTTPException(404, "Cita no encontrada")
    if appointment["test_mode"]:
        raise HTTPException(409, "Las citas de prueba no se sincronizan con Google Calendar")
    if appointment["calendar_sync_status"] == "synced" and appointment["calendar_event_id"]:
        return appointment

    definitions = await list_definitions("appointment")
    labels = {item["key"]: item["label"] for item in definitions}
    result = await create_google_event(appointment, labels)
    updated = await update_appointment_integrations(
        appointment_id,
        event_link=result["event_link"],
        calendar_event_id=result["event_id"],
        calendar_sync_status=result["status"],
        calendar_sync_error=result["error"],
        clear_calendar_sync_error=result["status"] == "synced",
    )
    if result["status"] == "not_configured":
        raise HTTPException(409, "Activa Google Calendar y guarda su configuración antes de sincronizar")
    if result["status"] == "error":
        raise HTTPException(502, result["error"])
    return updated


def _attachment(body: AppointmentCreate):
    if body.comprobante is None:
        return None
    content_type = normalize_media_content_type(body.comprobante.content_type, body.comprobante.filename)
    if content_type not in ALLOWED_COMPROBANTE_TYPES:
        raise HTTPException(400, "El comprobante debe ser una imagen JPG/PNG o un PDF")
    try:
        raw = base64.b64decode(body.comprobante.data_base64, validate=True)
    except Exception as exc:
        raise HTTPException(400, "El comprobante no es un archivo válido") from exc
    if not raw:
        raise HTTPException(400, "El comprobante está vacío")
    if len(raw) > MAX_COMPROBANTE_BYTES:
        raise HTTPException(413, "El comprobante supera el máximo de 10 MB")
    return {"Comprobante": (body.comprobante.filename, raw, content_type)}


@router.post("")
async def post_appointment(body: AppointmentCreate, user: User = Depends(get_current_user)):
    try:
        normalize_phone(body.telefono, await effective_country_code())
    except PhoneValidationError as exc:
        raise HTTPException(400, str(exc)) from exc
    if body.vendedor.strip() not in await _active_seller_names():
        raise HTTPException(400, "Vendedor inválido: elegí un usuario activo del equipo")
    if body.test_mode and user.role != "admin":
        raise HTTPException(403, "Solo un administrador puede enviar en modo prueba")
    try:
        custom_fields = await normalize_values("appointment", body.custom_fields, require_required=True)
    except CustomFieldError as exc:
        raise HTTPException(422, str(exc)) from exc

    files = _attachment(body)
    data = {
        "Nombre completo": body.nombre_completo, "DNI": body.dni,
        "Telefono": body.telefono, "Tratamiento": body.tratamiento,
        "Detalle": body.detalle, "Fecha": body.fecha, "Hora": body.hora,
        "Vendedor": body.vendedor, "Adelanto": str(body.adelanto),
        "DuracionMinutos": str(body.duration_minutes),
        "CamposPersonalizados": json.dumps(custom_fields, ensure_ascii=False),
        "formMode": "test" if body.test_mode else "production",
    }

    # La app es la fuente de verdad: se guarda antes de tocar conectores.
    appointment = await create_appointment_record(
        created_by_user_id=user.id, nombre_completo=body.nombre_completo,
        dni=body.dni, telefono=body.telefono, tratamiento=body.tratamiento,
        detalle=body.detalle, fecha=body.fecha, hora=body.hora,
        vendedor=body.vendedor, adelanto=body.adelanto,
        duration_minutes=body.duration_minutes, custom_fields=custom_fields,
        comprobante_filename=body.comprobante.filename if body.comprobante else None,
        test_mode=body.test_mode, status="created", n8n_status=None,
        message="Cita guardada en la app", event_link=None,
        calendar_sync_status="skipped" if body.test_mode else "pending",
    )

    definitions = await list_definitions("appointment")
    labels = {item["key"]: item["label"] for item in definitions}
    calendar_result = (
        {"status": "skipped", "event_id": None, "event_link": None, "error": None}
        if body.test_mode else await create_google_event(appointment, labels)
    )
    appointment = await update_appointment_integrations(
        appointment["id"], event_link=calendar_result["event_link"],
        calendar_event_id=calendar_result["event_id"],
        calendar_sync_status=calendar_result["status"],
        calendar_sync_error=calendar_result["error"],
    )

    integration_errors: list[str] = []
    if calendar_result["status"] == "error":
        integration_errors.append(calendar_result["error"])
    setting_key = "n8n_citas_webhook_test_url" if body.test_mode else "n8n_citas_webhook_url"
    webhook_url = await get_effective(setting_key)
    payload: dict = {"success": True}
    if not webhook_url:
        payload["message"] = "Cita guardada en el calendario de la app."
    else:
        try:
            response = await post_form(webhook_url, data, files, REQUEST_TIMEOUT_SECONDS)
            if response.status_code >= 400:
                message = response.text
                try:
                    error_payload = response.json()
                    message = error_payload.get("description") or error_payload.get("message") or message
                except ValueError:
                    pass
                integration_errors.append(message or "n8n rechazó la sincronización")
            else:
                try:
                    payload = response.json()
                except ValueError:
                    payload = {"success": True, "message": "Cita sincronizada"}
                if isinstance(payload, list):
                    payload = payload[0] if payload else {"success": True, "message": "Cita sincronizada"}
                if payload.get("success") is False:
                    integration_errors.append(payload.get("message") or "n8n informó un error")
        except httpx.HTTPError as exc:
            integration_errors.append(f"No se pudo sincronizar con n8n: {exc}")

    status = "duplicate" if payload.get("citaDuplicada") else "created_with_errors" if integration_errors else "created"
    event_link = appointment.get("event_link") or payload.get("eventLink")
    message = (
        "Cita guardada; " + " ".join(integration_errors)
        if integration_errors else payload.get("message") or "Cita guardada correctamente"
    )
    appointment = await update_appointment_integrations(
        appointment["id"], status=status, n8n_status=payload.get("status"),
        message=message, event_link=event_link,
    )
    if not body.test_mode:
        await _notify_new_appointment(appointment, user)
    return {
        **payload, "success": True, "message": message,
        "appointment": appointment, "eventLink": event_link,
        "calendarSyncStatus": appointment["calendar_sync_status"],
        "integrationErrors": integration_errors,
    }


async def _notify_new_appointment(appointment: dict, user: User) -> None:
    title = f"Nueva cita: {appointment['nombre_completo']}"
    text = f"{appointment['tratamiento']} · {appointment['fecha']} {appointment['hora']}"
    try:
        recipient_ids = {user.id, *(await list_active_admin_ids())}
        for recipient_id in recipient_ids:
            notification = await create_system_notification(
                recipient_id, NotificationType.APPOINTMENT, title, text,
                source_id=str(appointment["id"]), metadata={"appointment_id": appointment["id"]},
            )
            await manager.send_to_user(recipient_id, {"type": "notification_created", "notification": notification})
            await send_push_to_user(recipient_id, title, text, "/citas/nueva", tag=f"appointment-{appointment['id']}")
    except Exception:
        logger.exception("No se pudo avisar de la nueva cita %s", appointment["id"])

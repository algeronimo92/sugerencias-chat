"""Casos de uso de citas; la fila local se confirma antes de los conectores."""
from __future__ import annotations

import json
import logging

import httpx

from app.modules.appointments.repository import (
    create_appointment_record,
    get_appointment,
    update_appointment_integrations,
)
from app.modules.catalogs.ports.custom_fields import (list_definitions)
from app.modules.issue_reports.ports.service import (list_active_admin_ids)
from app.db.models.auth import User
from domain_types import NotificationType
from app.modules.appointments.schemas import AppointmentCreate
from app.integrations.google_calendar import create_google_event
from app.integrations.n8n.client import post_form
from app.modules.notifications.ports.service import (create_system_notification)
from app.modules.notifications.ports.push_service import (send_push_to_user)
from app.modules.platform.ports.settings_service import (get_effective)
from app.realtime.ws_manager import manager

logger = logging.getLogger(__name__)
REQUEST_TIMEOUT_SECONDS = 60.0


class AppointmentSyncError(Exception):
    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


async def sync_calendar(appointment_id: int) -> dict:
    appointment = await get_appointment(appointment_id)
    if appointment is None:
        raise AppointmentSyncError(404, "Cita no encontrada")
    if appointment["test_mode"]:
        raise AppointmentSyncError(409, "Las citas de prueba no se sincronizan con Google Calendar")
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
        raise AppointmentSyncError(409, "Activa Google Calendar y guarda su configuración antes de sincronizar")
    if result["status"] == "error":
        raise AppointmentSyncError(502, result["error"])
    return updated


async def create_appointment(
    body: AppointmentCreate,
    user: User,
    custom_fields: dict,
    files: dict | None,
) -> dict:
    data = {
        "Nombre completo": body.nombre_completo, "DNI": body.dni,
        "Telefono": body.telefono, "Tratamiento": body.tratamiento,
        "Detalle": body.detalle, "Fecha": body.fecha, "Hora": body.hora,
        "Vendedor": body.vendedor, "Adelanto": str(body.adelanto),
        "DuracionMinutos": str(body.duration_minutes),
        "CamposPersonalizados": json.dumps(custom_fields, ensure_ascii=False),
        "formMode": "test" if body.test_mode else "production",
    }

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

from app.modules.appointments import repository

async def list_appointments(limit: int=300) -> list[dict]:
    return await repository.list_appointments(limit)

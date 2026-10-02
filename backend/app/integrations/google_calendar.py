from datetime import datetime, timedelta
from urllib.parse import quote
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx

from app.modules.platform.ports.settings_service import (get_effective_many)


GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3"
TIMEOUT_SECONDS = 15.0


async def calendar_configuration() -> dict[str, str]:
    keys = (
        "google_calendar_enabled",
        "google_calendar_id",
        "google_calendar_client_id",
        "google_calendar_client_secret",
        "google_calendar_refresh_token",
        "business_timezone",
    )
    return await get_effective_many(keys)


def _enabled(config: dict[str, str]) -> bool:
    return config.get("google_calendar_enabled", "").lower() in {"true", "1", "yes", "on"}


def _response_error(response: httpx.Response, fallback: str) -> str:
    """Extrae el motivo de Google sin registrar tokens ni cuerpos completos."""

    try:
        payload = response.json()
    except ValueError:
        payload = {}
    error = payload.get("error") if isinstance(payload, dict) else None
    if isinstance(error, dict):
        detail = error.get("message") or error.get("status")
    else:
        detail = payload.get("error_description") if isinstance(payload, dict) else None
        detail = detail or (error if isinstance(error, str) else None)
    clean = " ".join(str(detail or fallback).split())[:300]
    return f"Google respondió {response.status_code}: {clean}"


async def create_google_event(appointment: dict, field_labels: dict[str, str]) -> dict:
    """Crea un evento mediante OAuth refresh token.

    Las credenciales vienen de app_settings, donde settings_service las cifra.
    Si la integración está apagada o incompleta, la cita local sigue siendo el
    resultado válido y se devuelve ``not_configured``.
    """
    config = await calendar_configuration()
    required = (
        "google_calendar_id",
        "google_calendar_client_id",
        "google_calendar_client_secret",
        "google_calendar_refresh_token",
    )
    if not _enabled(config):
        return {"status": "not_configured", "event_id": None, "event_link": None, "error": None}
    missing = [key for key in required if not config.get(key)]
    if missing:
        return {
            "status": "error",
            "event_id": None,
            "event_link": None,
            "error": "Google Calendar está activado, pero su configuración está incompleta",
        }

    timezone_name = config.get("business_timezone") or "America/Lima"
    try:
        timezone = ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError:
        return {"status": "error", "event_id": None, "event_link": None, "error": "Zona horaria inválida"}

    start = datetime.fromisoformat(f"{appointment['fecha']}T{appointment['hora']}").replace(tzinfo=timezone)
    end = start + timedelta(minutes=appointment.get("duration_minutes", 60))
    custom_lines = [
        f"{field_labels.get(key, key)}: {value}"
        for key, value in (appointment.get("custom_fields") or {}).items()
    ]
    description_lines = [
        appointment.get("detalle") or "",
        f"Contacto: {appointment['nombre_completo']}",
        f"Teléfono: {appointment['telefono']}",
        f"Responsable: {appointment['vendedor']}",
        *custom_lines,
    ]
    event = {
        "summary": appointment["tratamiento"],
        "description": "\n".join(line for line in description_lines if line),
        "start": {"dateTime": start.isoformat(), "timeZone": timezone_name},
        "end": {"dateTime": end.isoformat(), "timeZone": timezone_name},
        "extendedProperties": {"private": {"crmAppointmentId": str(appointment["id"]) }},
    }

    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as client:
            token_response = await client.post(
                GOOGLE_TOKEN_URL,
                data={
                    "client_id": config["google_calendar_client_id"],
                    "client_secret": config["google_calendar_client_secret"],
                    "refresh_token": config["google_calendar_refresh_token"],
                    "grant_type": "refresh_token",
                },
            )
            if token_response.is_error:
                return {
                    "status": "error", "event_id": None, "event_link": None,
                    "error": _response_error(token_response, "No se pudo renovar la autorización OAuth"),
                }
            access_token = token_response.json().get("access_token")
            if not access_token:
                raise httpx.HTTPError("Google no devolvió un access token")
            response = await client.post(
                f"{GOOGLE_CALENDAR_API}/calendars/{quote(config['google_calendar_id'], safe='')}/events",
                headers={"Authorization": f"Bearer {access_token}"},
                json=event,
            )
            if response.is_error:
                return {
                    "status": "error", "event_id": None, "event_link": None,
                    "error": _response_error(response, "No se pudo crear el evento"),
                }
            payload = response.json()
    except (httpx.HTTPError, ValueError, TypeError) as exc:
        # No se incluyen cuerpos de respuesta: pueden contener detalles de la
        # cuenta o credenciales y la cita ya está guardada localmente.
        return {"status": "error", "event_id": None, "event_link": None, "error": f"No se pudo sincronizar con Google Calendar: {exc}"}

    return {
        "status": "synced",
        "event_id": payload.get("id"),
        "event_link": payload.get("htmlLink"),
        "error": None,
    }

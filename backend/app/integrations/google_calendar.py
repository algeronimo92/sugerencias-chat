from datetime import datetime, timedelta
from urllib.parse import quote, urlencode
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx

from app.modules.platform.ports.platform_settings import platform_settings_many
from app.modules.platform.ports.settings_service import (get_effective_many)


GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke"
GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3"
# Crear eventos y listar los calendarios donde la cuenta puede escribir, para
# que el negocio elija uno en vez de pegar su ID.
GOOGLE_SCOPES = (
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
)
TIMEOUT_SECONDS = 15.0
RECONNECT_MESSAGE = (
    "La conexión con Google expiró o fue revocada; reconecta en Configuración → Calendario"
)


class GoogleOAuthError(RuntimeError):
    """Falla de Google al autorizar o al leer la cuenta. ``code`` es corto y
    viaja en la URL de vuelta al CRM; el mensaje no sale del backend."""

    def __init__(self, message: str, code: str = "google_error"):
        super().__init__(message)
        self.code = code


async def calendar_configuration() -> dict[str, str]:
    keys = (
        "google_calendar_enabled",
        "google_calendar_id",
        "google_calendar_client_id",
        "google_calendar_client_secret",
        "google_calendar_refresh_token",
        "business_timezone",
    )
    config = await get_effective_many(keys)
    client_id, client_secret = await oauth_client(config)
    return {**config, "google_calendar_client_id": client_id, "google_calendar_client_secret": client_secret}


async def oauth_client(config: dict[str, str] | None = None) -> tuple[str, str]:
    """Client ID y secret con que se renueva el token del negocio.

    Los propios del negocio (cargados a mano antes de "Conectar con Google")
    ganan: su refresh token se emitió para ese cliente y no sirve con otro.
    """
    if config is None:
        config = await get_effective_many(("google_calendar_client_id", "google_calendar_client_secret"))
    own_id = config.get("google_calendar_client_id") or ""
    own_secret = config.get("google_calendar_client_secret") or ""
    if own_id and own_secret:
        return own_id, own_secret
    platform = await platform_settings_many(("google_oauth_client_id", "google_oauth_client_secret"))
    return platform["google_oauth_client_id"], platform["google_oauth_client_secret"]


async def platform_oauth_config() -> dict[str, str]:
    return await platform_settings_many((
        "google_oauth_client_id", "google_oauth_client_secret", "google_oauth_redirect_uri",
    ))


async def platform_oauth_available() -> bool:
    return all((await platform_oauth_config()).values())


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


def _is_invalid_grant(response: httpx.Response) -> bool:
    try:
        payload = response.json()
    except ValueError:
        return False
    return isinstance(payload, dict) and payload.get("error") == "invalid_grant"


async def _access_token(client: httpx.AsyncClient, client_id: str, client_secret: str, refresh_token: str) -> str:
    """Cambia el refresh token por un access token. Levanta GoogleOAuthError
    con ``code="reconnect"`` cuando Google ya no acepta la autorización."""
    response = await client.post(
        GOOGLE_TOKEN_URL,
        data={
            "client_id": client_id,
            "client_secret": client_secret,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        },
    )
    if response.is_error:
        if _is_invalid_grant(response):
            raise GoogleOAuthError(RECONNECT_MESSAGE, "reconnect")
        raise GoogleOAuthError(_response_error(response, "No se pudo renovar la autorización OAuth"))
    access_token = response.json().get("access_token")
    if not access_token:
        raise GoogleOAuthError("Google no devolvió un access token")
    return access_token


def authorization_url(*, client_id: str, redirect_uri: str, state: str, code_challenge: str) -> str:
    # offline + consent: Google solo entrega refresh token en el primer
    # consentimiento; forzarlo cubre al negocio que reconecta la misma cuenta.
    return f"{GOOGLE_AUTH_URL}?" + urlencode({
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": " ".join(GOOGLE_SCOPES),
        "access_type": "offline",
        "prompt": "consent",
        "include_granted_scopes": "true",
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    })


async def exchange_code(code: str, code_verifier: str) -> str:
    """Canjea el código del callback por el refresh token del negocio."""
    config = await platform_oauth_config()
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as client:
            response = await client.post(
                GOOGLE_TOKEN_URL,
                data={
                    "client_id": config["google_oauth_client_id"],
                    "client_secret": config["google_oauth_client_secret"],
                    "redirect_uri": config["google_oauth_redirect_uri"],
                    "code": code,
                    "code_verifier": code_verifier,
                    "grant_type": "authorization_code",
                },
            )
    except httpx.HTTPError as exc:
        raise GoogleOAuthError(f"No se pudo contactar a Google: {exc}") from exc
    if response.is_error:
        raise GoogleOAuthError(_response_error(response, "Google rechazó el código"), "exchange_failed")
    refresh_token = response.json().get("refresh_token")
    if not refresh_token:
        raise GoogleOAuthError("Google no devolvió un refresh token", "no_refresh_token")
    return refresh_token


async def list_calendars(refresh_token: str | None = None) -> list[dict]:
    """Calendarios donde la cuenta conectada puede crear eventos, el principal
    primero. Sin ``refresh_token`` usa el guardado del negocio."""
    config = await get_effective_many((
        "google_calendar_client_id", "google_calendar_client_secret", "google_calendar_refresh_token",
    ))
    token = refresh_token or config["google_calendar_refresh_token"]
    if not token:
        raise GoogleOAuthError("Google Calendar no está conectado", "not_connected")
    client_id, client_secret = (
        await oauth_client({}) if refresh_token else await oauth_client(config)
    )
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as client:
            access_token = await _access_token(client, client_id, client_secret, token)
            response = await client.get(
                f"{GOOGLE_CALENDAR_API}/users/me/calendarList",
                headers={"Authorization": f"Bearer {access_token}"},
                params={"minAccessRole": "writer", "maxResults": 250},
            )
    except httpx.HTTPError as exc:
        raise GoogleOAuthError(f"No se pudo contactar a Google: {exc}") from exc
    if response.is_error:
        raise GoogleOAuthError(_response_error(response, "No se pudieron leer los calendarios"))
    items = [
        {
            "id": item["id"],
            "summary": item.get("summaryOverride") or item.get("summary") or item["id"],
            "primary": bool(item.get("primary")),
        }
        for item in response.json().get("items") or []
        if item.get("id")
    ]
    return sorted(items, key=lambda item: (not item["primary"], item["summary"].lower()))


async def revoke(refresh_token: str) -> bool:
    """Revoca el acceso en Google. Un fallo no debe impedir desconectar."""
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as client:
            response = await client.post(GOOGLE_REVOKE_URL, data={"token": refresh_token})
    except httpx.HTTPError:
        return False
    return not response.is_error


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
            access_token = await _access_token(
                client,
                config["google_calendar_client_id"],
                config["google_calendar_client_secret"],
                config["google_calendar_refresh_token"],
            )
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
    except GoogleOAuthError as exc:
        return {"status": "error", "event_id": None, "event_link": None, "error": str(exc)}
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

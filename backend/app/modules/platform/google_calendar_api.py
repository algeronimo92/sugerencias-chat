"""'Conectar con Google' para el calendario de citas.

El admin del negocio inicia el flujo desde su CRM (``router``, con sesión) y
Google vuelve a un callback único para todos los negocios
(``callback_router``, sin sesión ni host de negocio): el negocio sale del
``state`` firmado, ver google_oauth_state.py. El cliente OAuth es el de la
plataforma; el negocio solo guarda su refresh token y el calendario elegido.
"""

from __future__ import annotations

import hmac
import logging
import re
from urllib.parse import urlencode, urlsplit

from fastapi import APIRouter, Depends, Request
from fastapi.responses import PlainTextResponse, RedirectResponse

from app.core.config import settings
from app.core.errors import Conflict, Invalid, Unavailable
from app.integrations import google_calendar as google
from app.modules.auth.public import User, require_admin
from app.modules.platform.google_oauth_state import (
    InvalidOAuthState,
    OAuthState,
    code_challenge,
    code_verifier,
    decode_state,
    issue_state,
    new_nonce,
)
from app.modules.platform.schemas import (
    GoogleAuthorizeRequest,
    GoogleAuthorizeResponse,
    GoogleCalendarItem,
    GoogleCalendarSelection,
    GoogleCalendarStatus,
)
from app.modules.platform.settings_service import get_effective, get_effective_many, update_settings
from app.tenancy.context import get_current_tenant, tenant_context
from app.tenancy.resolver import (
    normalize_hostname,
    resolve_tenant_by_hostname,
    resolve_tenant_by_organization_id,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/settings/google-calendar", tags=["settings"])
callback_router = APIRouter(tags=["integrations"])

CALLBACK_PATH = "/api/integrations/google/callback"

# Todo lo que deja la conexión: desconectar lo limpia de una vez, incluidas
# las credenciales cargadas a mano antes del cliente de la plataforma.
_CONNECTION_KEYS = (
    "google_calendar_refresh_token",
    "google_calendar_account_email",
    "google_calendar_id",
    "google_calendar_client_id",
    "google_calendar_client_secret",
    "google_calendar_oauth_nonce",
)


async def _status() -> dict:
    values = await get_effective_many((
        "google_calendar_refresh_token",
        "google_calendar_account_email",
        "google_calendar_id",
        "google_calendar_enabled",
        "business_timezone",
    ))
    return {
        "oauth_available": await google.platform_oauth_available(),
        "connected": bool(values["google_calendar_refresh_token"]),
        "account_email": values["google_calendar_account_email"] or None,
        "calendar_id": values["google_calendar_id"] or None,
        "enabled": values["google_calendar_enabled"] == "true",
        "business_timezone": values["business_timezone"] or "America/Lima",
    }


def _google_failure(exc: google.GoogleOAuthError) -> Exception:
    if exc.code == "reconnect":
        return Conflict(str(exc), code="google_reconnect")
    if exc.code == "not_connected":
        return Conflict(str(exc), code="google_not_connected")
    return Unavailable(str(exc), code="google_error")


async def _validated_origin(raw: str, request: Request) -> str:
    """El origen al que vuelve el callback: tiene que ser un dominio de este
    mismo negocio, o el callback serviría para redirigir a cualquier lado."""
    parts = urlsplit(raw.strip())
    if (
        parts.scheme not in {"http", "https"}
        or not parts.hostname
        or parts.username or parts.password
        or parts.path not in {"", "/"}
        or parts.query or parts.fragment
    ):
        raise Invalid("Origen de retorno inválido")
    origin = f"{parts.scheme}://{parts.netloc.lower()}"

    current = get_current_tenant()
    if settings.multitenancy_enabled:
        try:
            owner = await resolve_tenant_by_hostname(normalize_hostname(parts.netloc))
        except ValueError:
            owner = None
        if current is None or owner is None or owner.organization_id != current.organization_id:
            raise Invalid("Origen de retorno inválido")
        return origin

    same_host = parts.netloc.lower() == (request.headers.get("host") or "").lower()
    allowed = origin in settings.cors_origins or (
        settings.cors_origin_regex is not None and re.fullmatch(settings.cors_origin_regex, origin)
    )
    if not (same_host or allowed):
        raise Invalid("Origen de retorno inválido")
    return origin


@router.get("/status", response_model=GoogleCalendarStatus)
async def get_google_calendar_status():
    return await _status()


@router.post("/authorize", response_model=GoogleAuthorizeResponse)
async def post_google_authorize(
    body: GoogleAuthorizeRequest,
    request: Request,
    user: User = Depends(require_admin),
):
    config = await google.platform_oauth_config()
    if not all(config.values()):
        raise Conflict(
            "La plataforma todavía no habilitó la conexión con Google",
            code="google_oauth_unavailable",
        )
    origin = await _validated_origin(body.return_origin, request)
    nonce = new_nonce()
    # Un flujo nuevo invalida el anterior que haya quedado a medias.
    await update_settings({"google_calendar_oauth_nonce": nonce})
    context = get_current_tenant()
    state = issue_state(context.organization_id if context else None, user.id, nonce, origin)
    return {
        "url": google.authorization_url(
            client_id=config["google_oauth_client_id"],
            redirect_uri=config["google_oauth_redirect_uri"],
            state=state,
            code_challenge=code_challenge(nonce),
        )
    }


@router.get("/calendars", response_model=list[GoogleCalendarItem])
async def get_google_calendars():
    try:
        return await google.list_calendars()
    except google.GoogleOAuthError as exc:
        raise _google_failure(exc) from exc


@router.put("/calendar", response_model=GoogleCalendarStatus)
async def put_google_calendar(body: GoogleCalendarSelection):
    try:
        calendars = await google.list_calendars()
    except google.GoogleOAuthError as exc:
        raise _google_failure(exc) from exc
    if body.calendar_id not in {item["id"] for item in calendars}:
        raise Invalid("Ese calendario no está entre los que la cuenta puede editar")
    await update_settings({"google_calendar_id": body.calendar_id, "google_calendar_enabled": "true"})
    return await _status()


@router.post("/disconnect", response_model=GoogleCalendarStatus)
async def post_google_disconnect():
    refresh_token = await get_effective("google_calendar_refresh_token")
    if refresh_token and not await google.revoke(refresh_token):
        # Se desconecta igual: el token deja de usarse acá y el negocio puede
        # quitar el acceso desde su cuenta de Google.
        logger.warning("Google no confirmó la revocación del token de Calendar")
    await update_settings({key: "" for key in _CONNECTION_KEYS} | {"google_calendar_enabled": "false"})
    return await _status()


async def _complete_connection(state: OAuthState, code: str | None, error: str | None) -> dict[str, str]:
    """Cierra el flujo dentro del negocio ya resuelto. Devuelve la query con
    que el CRM muestra el resultado; el detalle de Google queda en el log."""
    stored_nonce = await get_effective("google_calendar_oauth_nonce")
    if not stored_nonce or not hmac.compare_digest(stored_nonce, state.nonce):
        return {"google": "error", "reason": "expired"}
    await update_settings({"google_calendar_oauth_nonce": ""})

    if error:
        return {"google": "error", "reason": "denied" if error == "access_denied" else "google_error"}
    if not code:
        return {"google": "error", "reason": "google_error"}

    try:
        refresh_token = await google.exchange_code(code, code_verifier(state.nonce))
        calendars = await google.list_calendars(refresh_token)
    except google.GoogleOAuthError as exc:
        logger.warning("No se pudo completar la conexión con Google Calendar: %s", exc)
        return {"google": "error", "reason": exc.code}

    primary = next((item for item in calendars if item["primary"]), None)
    await update_settings({
        "google_calendar_refresh_token": refresh_token,
        "google_calendar_account_email": primary["id"] if primary else "",
        "google_calendar_id": primary["id"] if primary else (calendars[0]["id"] if calendars else "primary"),
        "google_calendar_enabled": "true",
        # El token nuevo es del cliente de la plataforma: credenciales propias
        # que hayan quedado de la carga manual ganarían y lo romperían.
        "google_calendar_client_id": "",
        "google_calendar_client_secret": "",
    })
    return {"google": "connected"}


@callback_router.get(CALLBACK_PATH, include_in_schema=False)
async def google_oauth_callback(state: str = "", code: str | None = None, error: str | None = None):
    try:
        claims = decode_state(state)
    except InvalidOAuthState:
        # Sin un state válido no se sabe a qué CRM volver.
        return PlainTextResponse(
            "El enlace para conectar Google Calendar venció o no es válido. "
            "Vuelve a intentarlo desde Configuración → Calendario.",
            status_code=400,
        )

    if settings.multitenancy_enabled:
        context = (
            await resolve_tenant_by_organization_id(claims.organization_id)
            if claims.organization_id else None
        )
        if context is None:
            return PlainTextResponse("El negocio de esta conexión no está activo.", status_code=400)
        with tenant_context(context):
            result = await _complete_connection(claims, code, error)
    else:
        result = await _complete_connection(claims, code, error)

    query = urlencode({"settings": "calendar", **result})
    return RedirectResponse(f"{claims.return_origin}/?{query}", status_code=302)

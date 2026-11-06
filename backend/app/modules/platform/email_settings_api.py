"""Pestaña Correo: cuenta conectada (OAuth) o SMTP propio, y correo de prueba.

"Conectar con Google/Microsoft/Zoho" sigue el mismo camino que "Conectar con
Google" de Calendar: el admin inicia desde su CRM (``router``, con sesión) y
el proveedor vuelve a un callback único para todos los negocios
(``callback_router``, sin sesión): el negocio sale del ``state`` firmado y
el nonce de un solo uso que guardó al iniciar.
"""

from __future__ import annotations

import logging
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import PlainTextResponse, RedirectResponse

from app.core.config import settings
from app.core.errors import Conflict, Invalid, Unavailable
from app.integrations import email_oauth
from app.integrations.email_service import (
    EmailDeliveryError,
    EmailNotConfiguredError,
    platform_transport,
    send_test_email,
)
from app.modules.auth.public import User, require_admin
from app.modules.platform.email_settings import (
    EmailSettingsError,
    clear_email_settings,
    clear_oauth_connection,
    consume_oauth_nonce,
    get_tenant_mail_oauth,
    read_email_settings,
    save_email_settings,
    start_oauth,
    store_oauth_connection,
)
from app.modules.platform.google_calendar_api import _validated_origin
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
    EmailConnectRequest,
    EmailSettingsStatus,
    EmailSettingsUpdate,
    EmailTestResult,
    GoogleAuthorizeResponse,
)
from app.tenancy.context import get_current_tenant, tenant_context
from app.tenancy.resolver import resolve_tenant_by_organization_id

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/settings/email", tags=["settings"])
callback_router = APIRouter(tags=["integrations"])

CALLBACK_PATH = "/api/integrations/email/callback"


async def _status(values: dict | None = None) -> dict:
    values = values if values is not None else await read_email_settings()
    return values | {
        "oauth_available": await email_oauth.available_providers(),
        "platform_available": platform_transport() is not None,
    }


async def _revoke_current() -> None:
    oauth = await get_tenant_mail_oauth()
    if oauth is None:
        return
    await email_oauth.revoke(
        email_oauth.Connection(
            provider=oauth.provider,
            refresh_token=oauth.refresh_token,
            account_email=oauth.account_email,
            accounts_server=oauth.accounts_server,
            account_id=oauth.account_id,
        )
    )


@router.get("", response_model=EmailSettingsStatus)
async def get_email_settings():
    return await _status()


@router.put("", response_model=EmailSettingsStatus)
async def put_email_settings(body: EmailSettingsUpdate):
    # Pasar a SMTP propio desconecta la cuenta: se revoca antes de olvidarla.
    await _revoke_current()
    try:
        values = await save_email_settings(**body.model_dump())
    except EmailSettingsError as exc:
        raise Invalid(str(exc), code="email_settings_invalid") from exc
    return await _status(values)


@router.delete("", response_model=EmailSettingsStatus)
async def delete_email_settings():
    await _revoke_current()
    return await _status(await clear_email_settings())


@router.post("/connect", response_model=GoogleAuthorizeResponse)
async def post_email_connect(
    body: EmailConnectRequest,
    request: Request,
    user: User = Depends(require_admin),
):
    client = await email_oauth.oauth_client(body.provider)
    if client is None:
        raise Conflict(
            f"La plataforma todavía no habilitó la conexión con {email_oauth.PROVIDER_LABELS[body.provider]}",
            code="email_oauth_unavailable",
        )
    origin = await _validated_origin(body.return_origin, request)
    nonce = new_nonce()
    await start_oauth(body.provider, nonce)
    context = get_current_tenant()
    state = issue_state(context.organization_id if context else None, user.id, nonce, origin)
    return {
        "url": email_oauth.authorization_url(
            body.provider, client, state=state, code_challenge=code_challenge(nonce)
        )
    }


@router.post("/disconnect", response_model=EmailSettingsStatus)
async def post_email_disconnect():
    await _revoke_current()
    return await _status(await clear_oauth_connection())


@router.post("/test", response_model=EmailTestResult)
async def post_email_test(user: User = Depends(require_admin)):
    try:
        transport = await send_test_email(recipient=user.email)
    except EmailNotConfiguredError as exc:
        raise Unavailable(
            "No hay correo de envío configurado: conecta el de tu negocio.",
            code="email_not_configured",
        ) from exc
    except EmailDeliveryError as exc:
        raise Unavailable(str(exc), code="email_delivery_failed") from exc
    return {"recipient": user.email, "source": transport.source}


async def _complete_connection(
    state: OAuthState, code: str | None, error: str | None, accounts_server: str | None
) -> dict[str, str]:
    """Cierra el flujo dentro del negocio ya resuelto. Devuelve la query con
    que el CRM muestra el resultado; el detalle del proveedor queda en el log."""

    provider = await consume_oauth_nonce(state.nonce)
    if provider is None:
        return {"email": "error", "reason": "expired"}
    if error:
        denied = error in {"access_denied", "consent_required"}
        return {"email": "error", "provider": provider, "reason": "denied" if denied else "provider_error"}
    if not code:
        return {"email": "error", "provider": provider, "reason": "provider_error"}

    client = await email_oauth.oauth_client(provider)
    if client is None:
        return {"email": "error", "provider": provider, "reason": "unavailable"}
    try:
        connection = await email_oauth.complete_authorization(
            provider,
            client,
            code=code,
            code_verifier=code_verifier(state.nonce),
            accounts_server=accounts_server,
        )
    except email_oauth.EmailOAuthError as exc:
        logger.warning("No se pudo conectar el correo con %s: %s", provider, exc.code)
        return {"email": "error", "provider": provider, "reason": exc.code}

    await store_oauth_connection(
        provider=connection.provider,
        refresh_token=connection.refresh_token,
        account_email=connection.account_email,
        accounts_server=connection.accounts_server,
        account_id=connection.account_id,
    )
    return {"email": "connected", "provider": provider}


@callback_router.get(CALLBACK_PATH, include_in_schema=False)
async def email_oauth_callback(
    state: str = "",
    code: str | None = None,
    error: str | None = None,
    accounts_server: str | None = Query(default=None, alias="accounts-server"),
):
    try:
        claims = decode_state(state)
    except InvalidOAuthState:
        # Sin un state válido no se sabe a qué CRM volver.
        return PlainTextResponse(
            "El enlace para conectar el correo venció o no es válido. "
            "Vuelve a intentarlo desde Configuración → Correo.",
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
            result = await _complete_connection(claims, code, error, accounts_server)
    else:
        result = await _complete_connection(claims, code, error, accounts_server)

    query = urlencode({"settings": "email", **result})
    return RedirectResponse(f"{claims.return_origin}/?{query}", status_code=302)

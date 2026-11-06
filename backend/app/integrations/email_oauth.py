"""Conectar el correo del negocio con un clic (OAuth) y enviar por su API.

Cada proveedor tiene una app OAuth registrada por la plataforma (como el
cliente de Google Calendar); el negocio solo autoriza su cuenta y guarda el
refresh token. No hay contraseña que custodiar ni SMTP que configurar.

- Google: Gmail API con ``gmail.send`` (alcance sensible, no restringido).
- Microsoft: Graph ``/me/sendMail`` con ``Mail.Send``; vale para Outlook.com
  y Microsoft 365. Microsoft rota el refresh token en cada renovación.
- Zoho: Zoho Mail API. Zoho tiene un centro de datos por región y avisa en
  el callback cuál es el de la cuenta (``accounts-server``).
"""

from __future__ import annotations

import base64
from dataclasses import dataclass
from email.message import EmailMessage
import json
import logging
from urllib.parse import urlencode

import httpx

from app.modules.platform.ports.platform_settings import platform_settings_many

logger = logging.getLogger(__name__)

PROVIDERS = ("google", "microsoft", "zoho")
PROVIDER_LABELS = {"google": "Google", "microsoft": "Microsoft", "zoho": "Zoho"}
TIMEOUT_SECONDS = 15.0
REDIRECT_KEY = "email_oauth_redirect_uri"
_CLIENT_KEYS = {
    # Google reutiliza el cliente de Calendar: es la misma app de la
    # plataforma en Google Cloud, con un alcance más.
    "google": ("google_oauth_client_id", "google_oauth_client_secret"),
    "microsoft": ("microsoft_oauth_client_id", "microsoft_oauth_client_secret"),
    "zoho": ("zoho_oauth_client_id", "zoho_oauth_client_secret"),
}

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke"
GOOGLE_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"
GOOGLE_SCOPES = ("openid", "email", "https://www.googleapis.com/auth/gmail.send")

MICROSOFT_AUTHORITY = "https://login.microsoftonline.com/common/oauth2/v2.0"
MICROSOFT_SEND_URL = "https://graph.microsoft.com/v1.0/me/sendMail"
MICROSOFT_SCOPES = ("openid", "email", "offline_access", "https://graph.microsoft.com/Mail.Send")

ZOHO_DEFAULT_ACCOUNTS = "https://accounts.zoho.com"
ZOHO_SCOPES = ("ZohoMail.messages.CREATE", "ZohoMail.accounts.READ")
# Centros de datos de Zoho: servidor de cuentas → servidor de Zoho Mail. El
# callback trae el de la cuenta; solo se aceptan estos, porque ahí se manda
# el client secret de la plataforma.
ZOHO_DATA_CENTERS = {
    "https://accounts.zoho.com": "https://mail.zoho.com",
    "https://accounts.zoho.eu": "https://mail.zoho.eu",
    "https://accounts.zoho.in": "https://mail.zoho.in",
    "https://accounts.zoho.com.au": "https://mail.zoho.com.au",
    "https://accounts.zoho.jp": "https://mail.zoho.jp",
    "https://accounts.zohocloud.ca": "https://mail.zohocloud.ca",
    "https://accounts.zoho.sa": "https://mail.zoho.sa",
    "https://accounts.zoho.com.cn": "https://mail.zoho.com.cn",
}


class EmailOAuthError(RuntimeError):
    """``code`` es corto y viaja en la URL de vuelta al CRM; el mensaje es
    apto para mostrar al admin y nunca trae tokens."""

    def __init__(self, message: str, code: str = "provider_error"):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class OAuthClient:
    client_id: str
    client_secret: str
    redirect_uri: str


@dataclass(frozen=True)
class Connection:
    """Lo que queda guardado del negocio tras autorizar su cuenta."""

    provider: str
    refresh_token: str
    account_email: str
    # Solo Zoho: el centro de datos de la cuenta y su id de buzón.
    accounts_server: str = ""
    account_id: str = ""


def _reconnect_message(provider: str) -> str:
    return (
        f"La conexión con {PROVIDER_LABELS[provider]} venció o fue revocada; "
        "vuelve a conectar el correo en Configuración → Correo"
    )


async def oauth_client(provider: str) -> OAuthClient | None:
    id_key, secret_key = _CLIENT_KEYS[provider]
    values = await platform_settings_many((id_key, secret_key, REDIRECT_KEY))
    if not all(values.values()):
        return None
    return OAuthClient(values[id_key], values[secret_key], values[REDIRECT_KEY])


async def available_providers() -> list[str]:
    return [provider for provider in PROVIDERS if await oauth_client(provider) is not None]


def authorization_url(provider: str, client: OAuthClient, *, state: str, code_challenge: str) -> str:
    if provider == "google":
        # offline + consent: Google solo entrega refresh token en el primer
        # consentimiento; forzarlo cubre al negocio que reconecta.
        return f"{GOOGLE_AUTH_URL}?" + urlencode({
            "client_id": client.client_id,
            "redirect_uri": client.redirect_uri,
            "response_type": "code",
            "scope": " ".join(GOOGLE_SCOPES),
            "access_type": "offline",
            "prompt": "consent",
            "state": state,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
        })
    if provider == "microsoft":
        return f"{MICROSOFT_AUTHORITY}/authorize?" + urlencode({
            "client_id": client.client_id,
            "redirect_uri": client.redirect_uri,
            "response_type": "code",
            "response_mode": "query",
            "scope": " ".join(MICROSOFT_SCOPES),
            "prompt": "select_account",
            "state": state,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
        })
    # Zoho redirige solo al centro de datos de la cuenta (la app de la
    # plataforma necesita "Multi-DC" activado en la consola de Zoho).
    return f"{ZOHO_DEFAULT_ACCOUNTS}/oauth/v2/auth?" + urlencode({
        "client_id": client.client_id,
        "redirect_uri": client.redirect_uri,
        "response_type": "code",
        "scope": ",".join(ZOHO_SCOPES),
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
    })


def _id_token_email(id_token: str | None) -> str:
    """Correo de la cuenta según el id_token.

    No se verifica la firma: el token llega directo del endpoint de tokens
    del proveedor por TLS, como permite OpenID Connect para ese canal.
    """

    if not id_token:
        return ""
    try:
        payload = id_token.split(".")[1]
        claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    except (IndexError, ValueError, UnicodeDecodeError):
        return ""
    return str(claims.get("email") or claims.get("preferred_username") or "").strip().lower()


def _token_url(provider: str, accounts_server: str = "") -> str:
    if provider == "google":
        return GOOGLE_TOKEN_URL
    if provider == "microsoft":
        return f"{MICROSOFT_AUTHORITY}/token"
    return f"{accounts_server or ZOHO_DEFAULT_ACCOUNTS}/oauth/v2/token"


def zoho_accounts_server(raw: str | None) -> str:
    server = (raw or ZOHO_DEFAULT_ACCOUNTS).strip().rstrip("/").lower()
    if server not in ZOHO_DATA_CENTERS:
        raise EmailOAuthError("Zoho devolvió un centro de datos desconocido", "provider_error")
    return server


async def _post_token(client: httpx.AsyncClient, url: str, data: dict) -> dict:
    response = await client.post(url, data=data)
    try:
        payload = response.json()
    except ValueError:
        payload = {}
    if not isinstance(payload, dict):
        payload = {}
    # Zoho responde 200 con {"error": ...} en vez de un status de error.
    if response.is_error or payload.get("error"):
        if payload.get("error") in {"invalid_grant", "invalid_code"}:
            raise EmailOAuthError("El proveedor ya no acepta esta autorización", "reconnect")
        logger.warning("El proveedor de correo rechazó el canje de tokens: %s", payload.get("error"))
        raise EmailOAuthError("El proveedor rechazó la autorización", "exchange_failed")
    return payload


async def complete_authorization(
    provider: str,
    client_config: OAuthClient,
    *,
    code: str,
    code_verifier: str,
    accounts_server: str | None = None,
) -> Connection:
    """Canjea el código del callback y averigua desde qué cuenta se enviará."""

    server = zoho_accounts_server(accounts_server) if provider == "zoho" else ""
    data = {
        "client_id": client_config.client_id,
        "client_secret": client_config.client_secret,
        "redirect_uri": client_config.redirect_uri,
        "code": code,
        "grant_type": "authorization_code",
    }
    if provider != "zoho":
        data["code_verifier"] = code_verifier
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as client:
            payload = await _post_token(client, _token_url(provider, server), data)
            refresh_token = payload.get("refresh_token")
            if not refresh_token:
                raise EmailOAuthError("El proveedor no entregó un acceso permanente", "no_refresh_token")
            if provider != "zoho":
                email = _id_token_email(payload.get("id_token"))
                if not email:
                    raise EmailOAuthError("No se pudo leer el correo de la cuenta", "provider_error")
                return Connection(provider, refresh_token, email)

            account_id, email = await _zoho_mailbox(client, server, payload.get("access_token", ""))
            return Connection(provider, refresh_token, email, server, account_id)
    except httpx.HTTPError as exc:
        raise EmailOAuthError("No se pudo contactar al proveedor de correo", "provider_error") from exc


async def _zoho_mailbox(client: httpx.AsyncClient, accounts_server: str, access_token: str) -> tuple[str, str]:
    response = await client.get(
        f"{ZOHO_DATA_CENTERS[accounts_server]}/api/accounts",
        headers={"Authorization": f"Zoho-oauthtoken {access_token}"},
    )
    if response.is_error:
        raise EmailOAuthError("Zoho no permitió leer el buzón de la cuenta", "no_mailbox")
    accounts = (response.json() or {}).get("data") or []
    if not accounts:
        raise EmailOAuthError("La cuenta de Zoho no tiene un buzón de Zoho Mail", "no_mailbox")
    account = accounts[0]
    email = str(account.get("primaryEmailAddress") or account.get("mailboxAddress") or "").strip().lower()
    return str(account.get("accountId") or ""), email


async def _access_token(client: httpx.AsyncClient, connection: Connection, config: OAuthClient) -> tuple[str, str | None]:
    """Access token vigente y, si el proveedor lo rotó, el refresh token nuevo."""

    data = {
        "client_id": config.client_id,
        "client_secret": config.client_secret,
        "refresh_token": connection.refresh_token,
        "grant_type": "refresh_token",
    }
    if connection.provider == "microsoft":
        data["scope"] = " ".join(MICROSOFT_SCOPES)
    try:
        payload = await _post_token(client, _token_url(connection.provider, connection.accounts_server), data)
    except EmailOAuthError as exc:
        if exc.code == "reconnect":
            raise EmailOAuthError(_reconnect_message(connection.provider), "reconnect") from exc
        raise
    access_token = payload.get("access_token")
    if not access_token:
        raise EmailOAuthError("El proveedor no entregó un permiso de envío")
    rotated = payload.get("refresh_token")
    return access_token, rotated if rotated and rotated != connection.refresh_token else None


async def send_message(
    connection: Connection, message: EmailMessage, *, recipients: list[str], subject: str, html_body: str
) -> str | None:
    """Envía por la API del proveedor. Devuelve el refresh token rotado, si hubo."""

    config = await oauth_client(connection.provider)
    if config is None:
        raise EmailOAuthError(
            f"La plataforma desactivó la conexión con {PROVIDER_LABELS[connection.provider]}",
            "unavailable",
        )
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as client:
            access_token, rotated = await _access_token(client, connection, config)
            if connection.provider == "google":
                raw = base64.urlsafe_b64encode(message.as_bytes()).decode("ascii")
                response = await client.post(
                    GOOGLE_SEND_URL,
                    headers={"Authorization": f"Bearer {access_token}"},
                    json={"raw": raw},
                )
            elif connection.provider == "microsoft":
                # Graph acepta el MIME completo en base64 con text/plain.
                response = await client.post(
                    MICROSOFT_SEND_URL,
                    headers={"Authorization": f"Bearer {access_token}", "Content-Type": "text/plain"},
                    content=base64.b64encode(message.as_bytes()),
                )
            else:
                response = await client.post(
                    f"{ZOHO_DATA_CENTERS[connection.accounts_server]}/api/accounts/{connection.account_id}/messages",
                    headers={"Authorization": f"Zoho-oauthtoken {access_token}"},
                    json={
                        "fromAddress": connection.account_email,
                        "toAddress": ",".join(recipients),
                        "subject": subject,
                        "content": html_body,
                        "mailFormat": "html",
                    },
                )
    except httpx.HTTPError as exc:
        raise EmailOAuthError("No se pudo contactar al proveedor de correo") from exc
    if response.is_error:
        logger.warning(
            "El proveedor %s rechazó un envío: status=%s", connection.provider, response.status_code
        )
        if response.status_code in {401, 403}:
            raise EmailOAuthError(
                f"{PROVIDER_LABELS[connection.provider]} no permitió enviar desde esta cuenta. "
                "Vuelve a conectarla y acepta el permiso de envío.",
                "forbidden",
            )
        raise EmailOAuthError(f"{PROVIDER_LABELS[connection.provider]} rechazó el envío")
    return rotated


async def revoke(connection: Connection) -> None:
    """Retira la autorización en el proveedor; es de mejor esfuerzo.

    Microsoft no tiene un endpoint para revocar un refresh token suelto: se
    olvida acá y el negocio puede quitar el acceso desde su cuenta.
    """

    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as client:
            if connection.provider == "google":
                await client.post(GOOGLE_REVOKE_URL, data={"token": connection.refresh_token})
            elif connection.provider == "zoho":
                await client.post(
                    f"{connection.accounts_server or ZOHO_DEFAULT_ACCOUNTS}/oauth/v2/token/revoke",
                    params={"token": connection.refresh_token},
                )
    except httpx.HTTPError:
        logger.warning("No se pudo revocar la conexión de correo con %s", connection.provider)

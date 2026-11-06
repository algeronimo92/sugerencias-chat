"""Correo de envío propio de cada negocio (SMTP).

Hasta ahora todos los negocios mandaban sus invitaciones desde el SMTP único
de la plataforma (``SMTP_*`` del .env). Cada negocio puede conectar su cuenta
con un clic (OAuth: Google, Microsoft o Zoho) o cargar un SMTP; si no hace
ninguna de las dos, se sigue usando el de la plataforma (ver
app/integrations/email_service.resolve_transport). Las dos formas propias
son excluyentes: guardar una borra la otra, para que nunca haya dudas de
desde dónde sale el correo.
"""

from __future__ import annotations

from dataclasses import dataclass
import hmac
import ipaddress
import re

from app.modules.platform.settings_service import get_effective_many, update_settings

HOST_KEY = "mail_smtp_host"
PORT_KEY = "mail_smtp_port"
SECURITY_KEY = "mail_smtp_security"
USERNAME_KEY = "mail_smtp_username"
PASSWORD_KEY = "mail_smtp_password"
FROM_ADDRESS_KEY = "mail_from_address"
FROM_NAME_KEY = "mail_from_name"
SMTP_KEYS = (
    HOST_KEY,
    PORT_KEY,
    SECURITY_KEY,
    USERNAME_KEY,
    PASSWORD_KEY,
    FROM_ADDRESS_KEY,
    FROM_NAME_KEY,
)
OAUTH_PROVIDER_KEY = "mail_oauth_provider"
OAUTH_REFRESH_KEY = "mail_oauth_refresh_token"
OAUTH_EMAIL_KEY = "mail_oauth_account_email"
OAUTH_SERVER_KEY = "mail_oauth_accounts_server"
OAUTH_ACCOUNT_ID_KEY = "mail_oauth_account_id"
OAUTH_NONCE_KEY = "mail_oauth_nonce"
OAUTH_PENDING_KEY = "mail_oauth_pending_provider"
OAUTH_KEYS = (
    OAUTH_PROVIDER_KEY,
    OAUTH_REFRESH_KEY,
    OAUTH_EMAIL_KEY,
    OAUTH_SERVER_KEY,
    OAUTH_ACCOUNT_ID_KEY,
)
EMAIL_KEYS = SMTP_KEYS + OAUTH_KEYS + (OAUTH_NONCE_KEY, OAUTH_PENDING_KEY)
OAUTH_PROVIDERS = ("google", "microsoft", "zoho")

# Solo puertos de envío de correo: el host lo escribe el negocio y el backend
# se conecta desde adentro del servidor; con cualquier puerto, "probar
# correo" serviría para sondear otros servicios.
ALLOWED_PORTS = (25, 465, 587, 2525)
# Sin opción en texto plano: la contraseña viajaría sin cifrar.
SECURITY_OPTIONS = ("starttls", "ssl")
DEFAULT_PORT = 587

_HOSTNAME_RE = re.compile(
    r"^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$"
)
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_INTERNAL_SUFFIXES = (".localhost", ".local", ".internal", ".lan", ".home.arpa")


class EmailSettingsError(ValueError):
    pass


@dataclass(frozen=True)
class TenantMailConfig:
    host: str
    port: int
    security: str
    username: str
    password: str
    from_address: str
    from_name: str


@dataclass(frozen=True)
class TenantMailOAuth:
    provider: str
    refresh_token: str
    account_email: str
    accounts_server: str
    account_id: str


def _parse_port(raw: str) -> int:
    try:
        return int(raw) if raw else DEFAULT_PORT
    except ValueError:
        return DEFAULT_PORT


async def get_tenant_mail_config() -> TenantMailConfig | None:
    """El SMTP del negocio activo, o ``None`` si no cargó uno completo."""

    values = await get_effective_many(EMAIL_KEYS)
    host = values[HOST_KEY].strip()
    from_address = values[FROM_ADDRESS_KEY].strip()
    if not host or not from_address:
        return None
    security = values[SECURITY_KEY].strip()
    return TenantMailConfig(
        host=host,
        port=_parse_port(values[PORT_KEY].strip()),
        security=security if security in SECURITY_OPTIONS else "starttls",
        username=values[USERNAME_KEY].strip(),
        password=values[PASSWORD_KEY],
        from_address=from_address,
        from_name=values[FROM_NAME_KEY].strip(),
    )


async def get_tenant_mail_oauth() -> TenantMailOAuth | None:
    """La cuenta conectada por OAuth del negocio activo, si la hay."""

    values = await get_effective_many(OAUTH_KEYS)
    provider = values[OAUTH_PROVIDER_KEY].strip()
    if provider not in OAUTH_PROVIDERS or not values[OAUTH_REFRESH_KEY]:
        return None
    return TenantMailOAuth(
        provider=provider,
        refresh_token=values[OAUTH_REFRESH_KEY],
        account_email=values[OAUTH_EMAIL_KEY].strip(),
        accounts_server=values[OAUTH_SERVER_KEY].strip(),
        account_id=values[OAUTH_ACCOUNT_ID_KEY].strip(),
    )


async def start_oauth(provider: str, nonce: str) -> None:
    if provider not in OAUTH_PROVIDERS:
        raise EmailSettingsError("Proveedor de correo desconocido")
    # Un flujo nuevo invalida el anterior que haya quedado a medias.
    await update_settings({OAUTH_NONCE_KEY: nonce, OAUTH_PENDING_KEY: provider})


async def consume_oauth_nonce(nonce: str) -> str | None:
    """Proveedor del flujo en curso si el nonce coincide; sirve una sola vez."""

    values = await get_effective_many((OAUTH_NONCE_KEY, OAUTH_PENDING_KEY))
    stored = values[OAUTH_NONCE_KEY]
    if not stored or not hmac.compare_digest(stored, nonce):
        return None
    await update_settings({OAUTH_NONCE_KEY: "", OAUTH_PENDING_KEY: ""})
    provider = values[OAUTH_PENDING_KEY].strip()
    return provider if provider in OAUTH_PROVIDERS else None


async def store_oauth_connection(
    *, provider: str, refresh_token: str, account_email: str, accounts_server: str = "", account_id: str = ""
) -> None:
    await update_settings(
        {key: "" for key in SMTP_KEYS}
        | {
            OAUTH_PROVIDER_KEY: provider,
            OAUTH_REFRESH_KEY: refresh_token,
            OAUTH_EMAIL_KEY: account_email,
            OAUTH_SERVER_KEY: accounts_server,
            OAUTH_ACCOUNT_ID_KEY: account_id,
        }
    )


async def store_rotated_refresh_token(refresh_token: str) -> None:
    # Microsoft entrega uno nuevo en cada renovación: el viejo deja de
    # servir tarde o temprano, así que se reemplaza en el acto.
    await update_settings({OAUTH_REFRESH_KEY: refresh_token})


async def clear_oauth_connection() -> dict:
    await update_settings({key: "" for key in OAUTH_KEYS})
    return await read_email_settings()


async def read_email_settings() -> dict:
    values = await get_effective_many(EMAIL_KEYS)
    security = values[SECURITY_KEY].strip()
    provider = values[OAUTH_PROVIDER_KEY].strip()
    oauth_connected = provider in OAUTH_PROVIDERS and bool(values[OAUTH_REFRESH_KEY])
    smtp_configured = bool(values[HOST_KEY].strip() and values[FROM_ADDRESS_KEY].strip())
    return {
        "configured": oauth_connected or smtp_configured,
        "mode": "oauth" if oauth_connected else ("smtp" if smtp_configured else None),
        "oauth_provider": provider if oauth_connected else None,
        "oauth_account_email": values[OAUTH_EMAIL_KEY].strip() if oauth_connected else None,
        "host": values[HOST_KEY].strip(),
        "port": _parse_port(values[PORT_KEY].strip()),
        "security": security if security in SECURITY_OPTIONS else "starttls",
        "username": values[USERNAME_KEY].strip(),
        # La contraseña nunca vuelve al navegador: solo se puede reemplazar.
        "password_configured": bool(values[PASSWORD_KEY]),
        "from_address": values[FROM_ADDRESS_KEY].strip(),
        "from_name": values[FROM_NAME_KEY].strip(),
    }


def _validate_host(raw: str) -> str:
    host = raw.strip().lower().rstrip(".")
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        address = None
    if address is not None:
        if not address.is_global:
            raise EmailSettingsError("El servidor SMTP debe ser una dirección pública")
        return host
    if not _HOSTNAME_RE.fullmatch(host) or host.endswith(_INTERNAL_SUFFIXES):
        raise EmailSettingsError("Escribe el servidor SMTP de tu proveedor, por ejemplo smtp.gmail.com")
    return host


def _single_line(value: str, *, field: str, max_length: int) -> str:
    cleaned = value.strip()
    if "\r" in cleaned or "\n" in cleaned or len(cleaned) > max_length:
        raise EmailSettingsError(f"{field} no es válido")
    return cleaned


async def save_email_settings(
    *,
    host: str,
    port: int,
    security: str,
    username: str,
    password: str | None,
    from_address: str,
    from_name: str,
) -> dict:
    """Guarda el SMTP del negocio. ``password=None`` conserva la guardada."""

    clean_host = _validate_host(host)
    if port not in ALLOWED_PORTS:
        raise EmailSettingsError(
            "Puerto no permitido. Usa " + ", ".join(str(p) for p in ALLOWED_PORTS)
        )
    if security not in SECURITY_OPTIONS:
        raise EmailSettingsError("Seguridad inválida: elige STARTTLS o SSL/TLS")
    clean_username = _single_line(username, field="El usuario", max_length=254)
    clean_from = _single_line(from_address, field="El correo remitente", max_length=254).lower()
    if not _EMAIL_RE.fullmatch(clean_from):
        raise EmailSettingsError("El correo remitente no es válido")
    clean_name = _single_line(from_name, field="El nombre del remitente", max_length=100)
    if password is not None and len(password) > 512:
        raise EmailSettingsError("La contraseña es demasiado larga")

    current = await get_effective_many((HOST_KEY, USERNAME_KEY, PASSWORD_KEY))
    moved = (
        clean_host != current[HOST_KEY].strip().lower()
        or clean_username != current[USERNAME_KEY].strip()
    )
    if password is None and current[PASSWORD_KEY] and moved:
        # Sin esto, otro admin podría apuntar el servidor a uno propio y
        # recibir la contraseña guardada en el primer envío.
        raise EmailSettingsError(
            "Vuelve a escribir la contraseña al cambiar el servidor o el usuario"
        )

    values = {
        HOST_KEY: clean_host,
        PORT_KEY: str(port),
        SECURITY_KEY: security,
        USERNAME_KEY: clean_username,
        FROM_ADDRESS_KEY: clean_from,
        FROM_NAME_KEY: clean_name,
    }
    if password is not None:
        values[PASSWORD_KEY] = password
    # SMTP propio y cuenta conectada son excluyentes.
    values |= {key: "" for key in OAUTH_KEYS}
    await update_settings(values)
    return await read_email_settings()


async def clear_email_settings() -> dict:
    """Vuelve al correo de la plataforma."""

    await update_settings({key: "" for key in EMAIL_KEYS})
    return await read_email_settings()

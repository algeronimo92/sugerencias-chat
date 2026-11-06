"""Correo de envío propio de cada negocio (SMTP).

Hasta ahora todos los negocios mandaban sus invitaciones desde el SMTP único
de la plataforma (``SMTP_*`` del .env). Cada negocio puede cargar el suyo;
si no lo hace, se sigue usando el de la plataforma (ver
app/integrations/email_service.resolve_transport).
"""

from __future__ import annotations

from dataclasses import dataclass
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
EMAIL_KEYS = (
    HOST_KEY,
    PORT_KEY,
    SECURITY_KEY,
    USERNAME_KEY,
    PASSWORD_KEY,
    FROM_ADDRESS_KEY,
    FROM_NAME_KEY,
)

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


async def read_email_settings() -> dict:
    values = await get_effective_many(EMAIL_KEYS)
    security = values[SECURITY_KEY].strip()
    return {
        "configured": bool(values[HOST_KEY].strip() and values[FROM_ADDRESS_KEY].strip()),
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
    await update_settings(values)
    return await read_email_settings()


async def clear_email_settings() -> dict:
    """Vuelve al correo de la plataforma."""

    await update_settings({key: "" for key in EMAIL_KEYS})
    return await read_email_settings()

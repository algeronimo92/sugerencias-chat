"""Correo de envío de la plataforma, editable desde el panel.

Es el remitente de respaldo de todos los negocios (invitaciones, cambios de
contraseña, avisos) cuando un negocio no conectó el suyo. Antes solo se podía
cambiar editando ``SMTP_*`` en el .env del servidor y reiniciando; ahora se
guarda cifrado en ``public.platform_settings`` y el .env queda como respaldo
de despliegue.

La configuración del panel se toma entera o no se toma: mezclar el servidor
del panel con el usuario o la contraseña del .env mandaría credenciales a un
host que no les corresponde.
"""

from __future__ import annotations

from dataclasses import dataclass
import ipaddress
import re

from app.core.config import settings
from app.modules.platform.email_settings import (
    SECURITY_OPTIONS,
    EmailSettingsError,
    _EMAIL_RE,
    _single_line,
)
from app.modules.platform.platform_settings import platform_settings_many, update_platform_settings

HOST_KEY = "platform_smtp_host"
PORT_KEY = "platform_smtp_port"
SECURITY_KEY = "platform_smtp_security"
USERNAME_KEY = "platform_smtp_username"
PASSWORD_KEY = "platform_smtp_password"
FROM_ADDRESS_KEY = "platform_email_from_address"
FROM_NAME_KEY = "platform_email_from_name"
KEYS = (
    HOST_KEY,
    PORT_KEY,
    SECURITY_KEY,
    USERNAME_KEY,
    PASSWORD_KEY,
    FROM_ADDRESS_KEY,
    FROM_NAME_KEY,
)
DEFAULT_PORT = 587

# A diferencia del SMTP de un negocio, este lo escribe un operador de la
# plataforma y puede ser un relay interno a propósito: se acepta cualquier
# nombre de host o IP, sin exigir que sea pública.
_HOST_RE = re.compile(
    r"^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$"
)


@dataclass(frozen=True)
class PlatformMailConfig:
    host: str
    port: int
    security: str
    username: str
    password: str
    from_address: str
    from_name: str


def _parse_port(raw: str) -> int:
    try:
        port = int(raw)
    except ValueError:
        return DEFAULT_PORT
    return port if 1 <= port <= 65535 else DEFAULT_PORT


def _config_from(values: dict[str, str]) -> PlatformMailConfig | None:
    host = values[HOST_KEY].strip()
    from_address = values[FROM_ADDRESS_KEY].strip()
    if not host or not from_address:
        return None
    security = values[SECURITY_KEY].strip()
    return PlatformMailConfig(
        host=host,
        port=_parse_port(values[PORT_KEY].strip()),
        security=security if security in SECURITY_OPTIONS else "starttls",
        username=values[USERNAME_KEY].strip(),
        password=values[PASSWORD_KEY],
        from_address=from_address,
        from_name=values[FROM_NAME_KEY].strip(),
    )


async def get_platform_mail_config() -> PlatformMailConfig | None:
    """El SMTP cargado en el panel, o ``None`` si no hay uno completo."""

    return _config_from(await platform_settings_many(KEYS))


def environment_mail_config() -> PlatformMailConfig | None:
    """El SMTP del .env, con las mismas reglas que antes de existir el panel."""

    if not (
        settings.email_provider.strip().lower() == "smtp"
        and settings.smtp_host.strip()
        and settings.email_from_address.strip()
        and not (settings.smtp_ssl and settings.smtp_starttls)
    ):
        return None
    return PlatformMailConfig(
        host=settings.smtp_host.strip(),
        port=settings.smtp_port,
        security="ssl" if settings.smtp_ssl else "starttls",
        username=settings.smtp_username,
        password=settings.smtp_password,
        from_address=settings.email_from_address.strip(),
        from_name=settings.email_from_name.strip(),
    )


async def read_platform_email() -> dict:
    values = await platform_settings_many(KEYS)
    panel = _config_from(values)
    environment = environment_mail_config()
    security = values[SECURITY_KEY].strip()
    return {
        "source": "platform" if panel else ("environment" if environment else None),
        "host": values[HOST_KEY].strip(),
        "port": _parse_port(values[PORT_KEY].strip()) if values[PORT_KEY].strip() else DEFAULT_PORT,
        "security": security if security in SECURITY_OPTIONS else "starttls",
        "username": values[USERNAME_KEY].strip(),
        # La contraseña nunca vuelve al navegador: solo se puede reemplazar.
        "password_configured": bool(values[PASSWORD_KEY]),
        "from_address": values[FROM_ADDRESS_KEY].strip(),
        "from_name": values[FROM_NAME_KEY].strip(),
        # Lo que hay en el .env, para saber a qué se vuelve al borrar el del
        # panel. Sin usuario ni contraseña.
        "environment_host": environment.host if environment else None,
        "environment_from_address": environment.from_address if environment else None,
    }


def _validate_host(raw: str) -> str:
    host = raw.strip().lower().rstrip(".")
    try:
        ipaddress.ip_address(host)
        return host
    except ValueError:
        pass
    if not _HOST_RE.fullmatch(host):
        raise EmailSettingsError("Escribe el servidor SMTP, por ejemplo smtp.hostinger.com")
    return host


async def save_platform_email(
    *,
    host: str,
    port: int,
    security: str,
    username: str,
    password: str | None,
    from_address: str,
    from_name: str,
) -> dict:
    """Guarda el SMTP de la plataforma. ``password=None`` conserva la guardada."""

    clean_host = _validate_host(host)
    if not 1 <= port <= 65535:
        raise EmailSettingsError("El puerto debe estar entre 1 y 65535")
    if security not in SECURITY_OPTIONS:
        raise EmailSettingsError("Seguridad inválida: elige STARTTLS o SSL/TLS")
    clean_username = _single_line(username, field="El usuario", max_length=254)
    clean_from = _single_line(from_address, field="El correo remitente", max_length=254).lower()
    if not _EMAIL_RE.fullmatch(clean_from):
        raise EmailSettingsError("El correo remitente no es válido")
    clean_name = _single_line(from_name, field="El nombre del remitente", max_length=100)
    if password is not None and len(password) > 512:
        raise EmailSettingsError("La contraseña es demasiado larga")

    current = await platform_settings_many((HOST_KEY, USERNAME_KEY, PASSWORD_KEY))
    moved = (
        clean_host != current[HOST_KEY].strip().lower()
        or clean_username != current[USERNAME_KEY].strip()
    )
    if password is None and current[PASSWORD_KEY] and moved:
        # Sin esto, cambiar el servidor mandaría la contraseña guardada a
        # otro host en el primer envío.
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
    await update_platform_settings(values, include_hidden=True)
    return await read_platform_email()


async def clear_platform_email() -> dict:
    """Borra el SMTP del panel; vuelve a usarse el del .env, si lo hay."""

    await update_platform_settings({key: "" for key in KEYS}, include_hidden=True)
    return await read_platform_email()

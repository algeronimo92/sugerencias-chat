"""Proveedor de correo transaccional y plantillas seguras de la aplicación."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from email.message import EmailMessage
from email.utils import formataddr
from html import escape
import ipaddress
import logging
import smtplib
import socket
import ssl
from urllib.parse import urlsplit

from app.core.config import settings
from app.modules.platform.ports.branding import (DEFAULT_BRANDING, OrganizationNotFound, get_branding)
from app.integrations import email_oauth
from app.modules.platform.ports.mail_settings import (
    get_tenant_mail_config,
    get_tenant_mail_oauth,
    store_rotated_refresh_token,
)
from app.tenancy.context import get_current_tenant


logger = logging.getLogger(__name__)


class EmailNotConfiguredError(RuntimeError):
    pass


class EmailDeliveryError(RuntimeError):
    pass


@dataclass(frozen=True)
class SmtpTransport:
    host: str
    port: int
    username: str
    password: str
    use_ssl: bool
    starttls: bool
    from_address: str
    from_name: str
    # "tenant": el SMTP que cargó el negocio; "platform": el del .env.
    source: str

    @property
    def restricted(self) -> bool:
        # El host del negocio lo escribe un usuario: solo puede ser público.
        # El de la plataforma puede ser un relay interno a propósito.
        return self.source == "tenant"


def platform_transport() -> SmtpTransport | None:
    if not (
        settings.email_provider.strip().lower() == "smtp"
        and settings.smtp_host.strip()
        and settings.email_from_address.strip()
        and not (settings.smtp_ssl and settings.smtp_starttls)
    ):
        return None
    return SmtpTransport(
        host=settings.smtp_host.strip(),
        port=settings.smtp_port,
        username=settings.smtp_username,
        password=settings.smtp_password,
        use_ssl=settings.smtp_ssl,
        starttls=settings.smtp_starttls,
        from_address=settings.email_from_address.strip(),
        from_name=settings.email_from_name.strip(),
        source="platform",
    )


async def tenant_transport() -> SmtpTransport | None:
    if get_current_tenant() is None:
        return None
    config = await get_tenant_mail_config()
    if config is None:
        return None
    return SmtpTransport(
        host=config.host,
        port=config.port,
        username=config.username,
        password=config.password,
        use_ssl=config.security == "ssl",
        starttls=config.security == "starttls",
        from_address=config.from_address,
        from_name=config.from_name,
        source="tenant",
    )


@dataclass(frozen=True)
class OAuthTransport:
    """Cuenta del negocio conectada con "Conectar con…": se envía por la API
    del proveedor, sin SMTP ni contraseña."""

    connection: email_oauth.Connection
    source: str = "tenant"


Transport = SmtpTransport | OAuthTransport


async def tenant_oauth_transport() -> OAuthTransport | None:
    if get_current_tenant() is None:
        return None
    oauth = await get_tenant_mail_oauth()
    if oauth is None:
        return None
    return OAuthTransport(
        email_oauth.Connection(
            provider=oauth.provider,
            refresh_token=oauth.refresh_token,
            account_email=oauth.account_email,
            accounts_server=oauth.accounts_server,
            account_id=oauth.account_id,
        )
    )


async def resolve_transport() -> Transport | None:
    """La cuenta conectada del negocio, su SMTP, o el de la plataforma."""

    return await tenant_oauth_transport() or await tenant_transport() or platform_transport()


async def email_is_configured() -> bool:
    return await resolve_transport() is not None


def public_app_url() -> str:
    """URL canónica del negocio sin confiar en headers de la solicitud."""

    context = get_current_tenant()
    if context is not None:
        scheme = settings.app_public_scheme.strip().lower()
        if scheme not in {"http", "https"}:
            raise EmailNotConfiguredError("APP_PUBLIC_SCHEME debe ser http o https")
        return f"{scheme}://{context.hostname}"

    configured = settings.app_public_url.strip().rstrip("/")
    parsed = urlsplit(configured)
    if not configured or parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise EmailNotConfiguredError(
            "APP_PUBLIC_URL es obligatorio para correo en modo single-tenant"
        )
    if parsed.username or parsed.password:
        raise EmailNotConfiguredError("APP_PUBLIC_URL no puede contener credenciales")
    return configured


async def current_brand_name() -> str:
    context = get_current_tenant()
    if context is None:
        return DEFAULT_BRANDING.name
    try:
        return (await get_branding(context.organization_id)).name
    except OrganizationNotFound:
        return DEFAULT_BRANDING.name


class EmailHostRejected(EmailDeliveryError):
    pass


def _public_address(host: str, port: int) -> str:
    """Resuelve una sola vez y exige que todas las IP sean públicas.

    La conexión va a la IP ya validada: si se resolviera de nuevo al
    conectar, un DNS que cambia de respuesta (rebinding) llevaría el SMTP
    del negocio a postgres, redis o la red interna del servidor.
    """

    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise EmailDeliveryError("No se encontró el servidor SMTP. Revisa el nombre.") from exc
    addresses = [info[4][0] for info in infos]
    if not addresses or any(
        not ipaddress.ip_address(address.split("%", 1)[0]).is_global for address in addresses
    ):
        raise EmailHostRejected("El servidor SMTP debe ser una dirección pública")
    return addresses[0]


class _PinnedSMTP(smtplib.SMTP):
    def __init__(self, *, pinned_ip: str, **kwargs) -> None:
        self._pinned_ip = pinned_ip
        super().__init__(**kwargs)

    def _get_socket(self, host, port, timeout):
        # ``self._host`` sigue siendo el nombre: STARTTLS valida el
        # certificado contra él, no contra la IP.
        return socket.create_connection((self._pinned_ip, port), timeout, self.source_address)


class _PinnedSMTPSSL(smtplib.SMTP_SSL):
    def __init__(self, *, pinned_ip: str, **kwargs) -> None:
        self._pinned_ip = pinned_ip
        super().__init__(**kwargs)

    def _get_socket(self, host, port, timeout):
        sock = socket.create_connection((self._pinned_ip, port), timeout, self.source_address)
        return self.context.wrap_socket(sock, server_hostname=self._host)


def _open_client(transport: SmtpTransport) -> smtplib.SMTP:
    kwargs: dict = {
        "host": transport.host,
        "port": transport.port,
        "timeout": settings.smtp_timeout_seconds,
    }
    if transport.use_ssl:
        kwargs["context"] = ssl.create_default_context()
    if transport.restricted:
        pinned_ip = _public_address(transport.host, transport.port)
        pinned_class = _PinnedSMTPSSL if transport.use_ssl else _PinnedSMTP
        return pinned_class(pinned_ip=pinned_ip, **kwargs)
    smtp_class = smtplib.SMTP_SSL if transport.use_ssl else smtplib.SMTP
    return smtp_class(**kwargs)


def _smtp_send(message: EmailMessage, transport: SmtpTransport) -> None:
    client = _open_client(transport)
    try:
        client.ehlo()
        if transport.starttls:
            client.starttls(context=ssl.create_default_context())
            client.ehlo()
        if transport.username:
            client.login(transport.username, transport.password)
        client.send_message(message)
    finally:
        try:
            client.quit()
        except (OSError, smtplib.SMTPException):
            client.close()


def _delivery_reason(exc: BaseException) -> str:
    """Motivo entendible para el admin que configura su correo.

    Nunca incluye la respuesta del servidor: puede traer el usuario o datos
    internos del proveedor.
    """

    if isinstance(exc, EmailDeliveryError):
        return str(exc)
    if isinstance(exc, smtplib.SMTPAuthenticationError):
        return (
            "El servidor rechazó el usuario o la contraseña. En Gmail y Outlook "
            "se usa una contraseña de aplicación, no la de la cuenta."
        )
    if isinstance(exc, smtplib.SMTPSenderRefused):
        return "El servidor no permite enviar desde ese correo remitente."
    if isinstance(exc, smtplib.SMTPRecipientsRefused):
        return "El servidor rechazó al destinatario."
    if isinstance(exc, smtplib.SMTPNotSupportedError):
        return "El servidor no admite STARTTLS en ese puerto. Prueba SSL/TLS en el puerto 465."
    if isinstance(exc, ssl.SSLError):
        return "Falló la conexión segura. Revisa que el puerto coincida con la seguridad elegida."
    if isinstance(exc, TimeoutError):
        return "El servidor SMTP no respondió a tiempo. Revisa el servidor y el puerto."
    if isinstance(exc, ConnectionRefusedError):
        return "El servidor SMTP rechazó la conexión en ese puerto."
    return "El proveedor de correo rechazó el envío."


async def send_email(
    *,
    recipients: list[str],
    subject: str,
    text_body: str,
    html_body: str,
    transport: Transport | None = None,
) -> None:
    transport = transport or await resolve_transport()
    if transport is None:
        raise EmailNotConfiguredError("El proveedor SMTP no está configurado")
    clean_recipients = sorted({address.strip().lower() for address in recipients if address.strip()})
    if not clean_recipients:
        return
    if isinstance(transport, OAuthTransport):
        from_name, from_address = await current_brand_name(), transport.connection.account_email
    else:
        from_name, from_address = transport.from_name, transport.from_address
        if transport.source == "tenant" and not from_name:
            from_name = await current_brand_name()
    message = EmailMessage()
    message["From"] = formataddr((from_name, from_address))
    message["To"] = ", ".join(clean_recipients)
    message["Subject"] = subject
    message.set_content(text_body)
    message.add_alternative(html_body, subtype="html")
    if isinstance(transport, OAuthTransport):
        await _send_with_oauth(transport, message, clean_recipients, subject, html_body)
        return
    try:
        await asyncio.to_thread(_smtp_send, message, transport)
    except (OSError, smtplib.SMTPException, EmailDeliveryError) as exc:
        logger.warning(
            "No se pudo entregar correo transaccional (origen=%s): %s",
            transport.source,
            type(exc).__name__,
        )
        raise EmailDeliveryError(_delivery_reason(exc)) from exc


async def _send_with_oauth(
    transport: OAuthTransport, message: EmailMessage, recipients: list[str], subject: str, html_body: str
) -> None:
    try:
        rotated = await email_oauth.send_message(
            transport.connection, message, recipients=recipients, subject=subject, html_body=html_body
        )
    except email_oauth.EmailOAuthError as exc:
        logger.warning(
            "No se pudo entregar correo por %s: %s", transport.connection.provider, exc.code
        )
        raise EmailDeliveryError(str(exc)) from exc
    if rotated:
        await store_rotated_refresh_token(rotated)


async def send_test_email(*, recipient: str) -> Transport:
    """Manda una prueba con el mismo transporte que usarían las invitaciones."""

    transport = await resolve_transport()
    if transport is None:
        raise EmailNotConfiguredError("No hay correo de envío configurado")
    brand = await current_brand_name()
    origin = "el correo de tu negocio" if transport.source == "tenant" else "el correo de la plataforma"
    await send_email(
        recipients=[recipient],
        subject=f"Correo de prueba de {brand}",
        text_body=f"Este es un correo de prueba. Las invitaciones de {brand} salen desde {origin}.",
        html_body=(
            '<!doctype html><html lang="es"><body style="font-family:Arial,sans-serif;color:#172b27">'
            '<div style="max-width:560px;margin:24px auto;border:1px solid #dce7e3;border-radius:16px;padding:28px">'
            f'<p style="font-weight:700">{escape(brand)}</p><h1 style="font-size:22px">Correo de prueba</h1>'
            f'<p style="line-height:1.6;color:#52635f">Todo listo: las invitaciones de {escape(brand)} '
            f'salen desde {escape(origin)}.</p></div></body></html>'
        ),
        transport=transport,
    )
    return transport


def _action_html(*, brand: str, greeting: str, message: str, action: str, url: str, expiry: str) -> str:
    return f"""<!doctype html>
<html lang="es"><body style="margin:0;background:#f3f7f6;font-family:Arial,sans-serif;color:#172b27">
<div style="max-width:560px;margin:0 auto;padding:32px 18px">
  <div style="background:#fff;border:1px solid #dce7e3;border-radius:18px;padding:30px">
    <p style="margin:0 0 22px;font-size:18px;font-weight:700">{escape(brand)}</p>
    <h1 style="font-size:24px;margin:0 0 14px">{escape(greeting)}</h1>
    <p style="line-height:1.6;color:#52635f">{escape(message)}</p>
    <p style="margin:26px 0"><a href="{escape(url, quote=True)}" style="display:inline-block;background:#00876a;color:#fff;text-decoration:none;font-weight:700;padding:13px 20px;border-radius:10px">{escape(action)}</a></p>
    <p style="font-size:13px;line-height:1.5;color:#70807c">Este enlace vence {escape(expiry)} y solo puede usarse una vez. Si no solicitaste esta acción, ignora este correo.</p>
  </div>
</div></body></html>"""


async def send_invitation(*, recipient: str, name: str, token: str) -> None:
    brand = await current_brand_name()
    url = f"{public_app_url()}/accept-invitation?token={token}"
    subject = f"Te invitaron a {brand}"
    message = f"Hola {name}, crea tu contraseña para acceder a {brand}."
    await send_email(
        recipients=[recipient],
        subject=subject,
        text_body=f"{message}\n\n{url}\n\nEl enlace vence en {settings.invitation_expire_hours} horas y es de un solo uso.",
        html_body=_action_html(
            brand=brand,
            greeting=f"Hola, {name}",
            message=f"Tu equipo te invitó a {brand}. Crea tu contraseña para comenzar.",
            action="Aceptar invitación",
            url=url,
            expiry=f"en {settings.invitation_expire_hours} horas",
        ),
    )


async def send_password_reset(*, recipient: str, name: str, token: str) -> None:
    brand = await current_brand_name()
    url = f"{public_app_url()}/reset-password?token={token}"
    subject = f"Restablece tu contraseña de {brand}"
    await send_email(
        recipients=[recipient],
        subject=subject,
        text_body=(
            f"Hola {name}, usa este enlace para restablecer tu contraseña:\n\n{url}\n\n"
            f"Vence en {settings.password_reset_expire_minutes} minutos y es de un solo uso."
        ),
        html_body=_action_html(
            brand=brand,
            greeting=f"Hola, {name}",
            message="Recibimos una solicitud para restablecer tu contraseña.",
            action="Restablecer contraseña",
            url=url,
            expiry=f"en {settings.password_reset_expire_minutes} minutos",
        ),
    )


async def send_operational_alert(
    *, recipients: list[str], subject: str, title: str, message: str
) -> None:
    brand = await current_brand_name()
    escaped_message = escape(message).replace("\n", "<br>")
    await send_email(
        recipients=recipients,
        subject=subject,
        text_body=f"{title}\n\n{message}\n\n{brand}",
        html_body=(
            '<!doctype html><html lang="es"><body style="font-family:Arial,sans-serif;color:#172b27">'
            '<div style="max-width:560px;margin:24px auto;border:1px solid #dce7e3;border-radius:16px;padding:28px">'
            f'<p style="font-weight:700">{escape(brand)}</p><h1 style="font-size:22px">{escape(title)}</h1>'
            f'<p style="line-height:1.6;color:#52635f">{escaped_message}</p></div></body></html>'
        ),
    )

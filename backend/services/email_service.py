"""Proveedor de correo transaccional y plantillas seguras de la aplicación."""

from __future__ import annotations

import asyncio
from email.message import EmailMessage
from email.utils import formataddr
from html import escape
import logging
import smtplib
import ssl
from urllib.parse import urlsplit

from config import settings
from services.branding import DEFAULT_BRANDING, OrganizationNotFound, get_branding
from tenancy.context import get_current_tenant


logger = logging.getLogger(__name__)


class EmailNotConfiguredError(RuntimeError):
    pass


class EmailDeliveryError(RuntimeError):
    pass


def email_is_configured() -> bool:
    return (
        settings.email_provider.strip().lower() == "smtp"
        and bool(settings.smtp_host.strip())
        and bool(settings.email_from_address.strip())
        and not (settings.smtp_ssl and settings.smtp_starttls)
    )


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


def _smtp_send(message: EmailMessage) -> None:
    smtp_class = smtplib.SMTP_SSL if settings.smtp_ssl else smtplib.SMTP
    kwargs = {
        "host": settings.smtp_host.strip(),
        "port": settings.smtp_port,
        "timeout": settings.smtp_timeout_seconds,
    }
    client = smtp_class(context=ssl.create_default_context(), **kwargs) if settings.smtp_ssl else smtp_class(**kwargs)
    try:
        client.ehlo()
        if settings.smtp_starttls:
            client.starttls(context=ssl.create_default_context())
            client.ehlo()
        if settings.smtp_username:
            client.login(settings.smtp_username, settings.smtp_password)
        client.send_message(message)
    finally:
        try:
            client.quit()
        except (OSError, smtplib.SMTPException):
            client.close()


async def send_email(
    *, recipients: list[str], subject: str, text_body: str, html_body: str
) -> None:
    if not email_is_configured():
        raise EmailNotConfiguredError("El proveedor SMTP no está configurado")
    clean_recipients = sorted({address.strip().lower() for address in recipients if address.strip()})
    if not clean_recipients:
        return
    message = EmailMessage()
    message["From"] = formataddr(
        (settings.email_from_name.strip(), settings.email_from_address.strip())
    )
    message["To"] = ", ".join(clean_recipients)
    message["Subject"] = subject
    message.set_content(text_body)
    message.add_alternative(html_body, subtype="html")
    try:
        await asyncio.to_thread(_smtp_send, message)
    except (OSError, smtplib.SMTPException) as exc:
        logger.warning("No se pudo entregar correo transaccional: %s", type(exc).__name__)
        raise EmailDeliveryError("El proveedor de correo rechazó el envío") from exc


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

"""Los conectores externos de las citas: Google Calendar, el workflow de
citas de n8n y el envío por WhatsApp de los avisos de cita."""

from __future__ import annotations

import asyncio
import logging

import httpx

from app.integrations.google_calendar import create_google_event
from app.integrations.meta.channel import MetaAccountNumbers, MetaMessageSender
from app.integrations.storage.media_storage import read_media_bytes, stat_media
from app.integrations.n8n.client import post_form
from app.modules.appointments.domain.appointment import SyncResult
from app.modules.appointments.domain.calendar_event import EventContent
from app.integrations.whatsapp.channel import SEND_FAILURES
from app.integrations.whatsapp.channels import current_channel
from app.modules.appointments.domain.errors import NoticeAccountUnavailable, NoticeNotSent, NoticeSenderNotLinked
from app.modules.auth.ports.users import list_active_sellers, staff_phones
from app.modules.conversations.ports.template_sending import (
    ChatMessagingError,
    official_template_message,
    send_template,
)
from app.modules.platform.ports.settings_service import get_effective

REQUEST_TIMEOUT_SECONDS = 60.0

logger = logging.getLogger(__name__)


class GoogleCalendar:
    async def create_event(self, appointment: dict, content: EventContent) -> dict:
        return await create_google_event(appointment, title=content.title, description=content.description)


class N8nAppointmentSync:
    """Manda la cita al webhook de citas de n8n y traduce su respuesta. El
    workflow responde un objeto (o una lista con uno) con ``success`` y
    ``message``; un error se explica en ``description`` o ``message``."""

    async def submit(self, *, test_mode: bool, form: dict, files: dict | None) -> SyncResult:
        setting_key = "n8n_citas_webhook_test_url" if test_mode else "n8n_citas_webhook_url"
        webhook_url = await get_effective(setting_key)
        if not webhook_url:
            return SyncResult(configured=False)
        try:
            response = await post_form(webhook_url, form, files, REQUEST_TIMEOUT_SECONDS)
        except httpx.HTTPError as exc:
            return SyncResult(configured=True, error=f"No se pudo sincronizar con n8n: {exc}")
        if response.status_code >= 400:
            message = response.text
            try:
                error_payload = response.json()
                message = error_payload.get("description") or error_payload.get("message") or message
            except ValueError:
                pass
            return SyncResult(configured=True, error=message or "n8n rechazó la sincronización")
        try:
            payload = response.json()
        except ValueError:
            payload = {"success": True, "message": "Cita sincronizada"}
        if isinstance(payload, list):
            payload = payload[0] if payload else {"success": True, "message": "Cita sincronizada"}
        error = (payload.get("message") or "n8n informó un error") if payload.get("success") is False else None
        return SyncResult(configured=True, payload=payload, error=error)



class WhatsAppNoticeMessenger:
    """Al cliente, por el mismo outbox que cualquier mensaje del chat: queda
    en la conversación del lead. Al equipo, directo por el canal: un número
    del equipo no es un lead y no tiene por qué aparecer en el CRM."""

    async def send_to_lead(
        self, *, chat_id: str, template_id: int, parameters: list[str], user_id: int, dedupe_key: str,
    ) -> int | None:
        try:
            sent = await send_template(chat_id, template_id, None, parameters, user_id, dedupe_key=dedupe_key)
        except ChatMessagingError as exc:
            raise NoticeNotSent(str(exc)) from exc
        return sent[0]["id"] if sent else None

    async def send_to_phone(
        self, *, phone: str, template: dict, parameters: list[str], sender: str | None = None,
    ) -> str | None:
        try:
            if sender is None:
                message = await official_template_message(template, parameters)
                receipt = await current_channel().sender.send_to_number(phone, message)
                return receipt.provider_message_id
            message = await official_template_message(
                template, parameters, header_media_id=await _header_media_id(template, sender),
            )
            receipt = await MetaMessageSender().send_to_number(phone, message, sender=sender)
        except (ChatMessagingError, *SEND_FAILURES) as exc:
            raise NoticeNotSent(str(exc)) from exc
        return receipt.provider_message_id

    async def send_to_lead_from(
        self, *, chat_id: str, template: dict, parameters: list[str], sender: str,
    ) -> str | None:
        try:
            message = await official_template_message(
                template, parameters, header_media_id=await _header_media_id(template, sender),
            )
            receipt = await MetaMessageSender().send_from(chat_id, message, sender=sender)
        except (ChatMessagingError, *SEND_FAILURES) as exc:
            raise NoticeNotSent(str(exc)) from exc
        return receipt.provider_message_id


async def _header_media_id(template: dict, sender: str) -> str | None:
    """Sube la imagen del encabezado con el número que va a enviar: Meta solo
    acepta un id de medio subido por ese mismo número."""
    url = template.get("official_header_media_url")
    if template.get("official_header_type") != "image" or not url:
        return None
    info = await asyncio.to_thread(stat_media, url)
    content = await asyncio.to_thread(read_media_bytes, url)
    filename = template.get("official_header_media_filename") or url.rsplit("/", 1)[-1]
    return await MetaMessageSender().upload_media(content, info.content_type, filename, sender=sender)


class MetaNoticeSenders:
    """El número de avisos está en la WABA del CRM o en otra del mismo
    portfolio. El token del CRM sirve para las dos; las plantillas, en la
    otra WABA, son copias."""

    async def numbers(self, extra_waba_id: str | None = None) -> list[dict]:
        accounts = MetaAccountNumbers()
        try:
            numbers = await accounts.list()
            crm_number = await get_effective("meta_phone_number_id")
        except (*SEND_FAILURES, httpx.HTTPError) as exc:
            raise NoticeAccountUnavailable(str(exc)) from exc
        if extra_waba_id and all(item["waba_id"] != extra_waba_id for item in numbers):
            try:
                numbers += await accounts.list(extra_waba_id)
            except (*SEND_FAILURES, httpx.HTTPError):
                # Sin acceso a la WABA de avisos la tarjeta igual muestra los
                # números del CRM; el envío fallará y quedará en el historial.
                logger.warning("No se pudieron leer los números de la WABA de avisos %s", extra_waba_id, exc_info=True)
        return [{**item, "is_crm": item["id"] == crm_number} for item in numbers]

    async def account_name(self, waba_id: str) -> str:
        try:
            return await MetaAccountNumbers().account_name(waba_id)
        except (*SEND_FAILURES, httpx.HTTPError):
            return ""

    async def register(self, phone_number_id: str, waba_id: str | None = None) -> None:
        await MetaAccountNumbers().register(phone_number_id, waba_id)

    async def templates(self, waba_id: str) -> list[dict]:
        try:
            return await MetaAccountNumbers().templates(waba_id)
        except (*SEND_FAILURES, httpx.HTTPError) as exc:
            raise NoticeAccountUnavailable(str(exc)) from exc

    async def copy_template(self, meta_template_id: str, waba_id: str) -> None:
        try:
            await MetaAccountNumbers().copy_template(meta_template_id, waba_id)
        except (*SEND_FAILURES, httpx.HTTPError) as exc:
            raise NoticeAccountUnavailable(str(exc)) from exc

    async def unregister(self, phone_number_id: str) -> None:
        await MetaAccountNumbers().unregister(phone_number_id)

    async def complete_signup(self, code: str, waba_id: str, phone_number_id: str | None) -> dict[str, str]:
        try:
            return await MetaAccountNumbers().complete_signup(code, waba_id, phone_number_id)
        except (*SEND_FAILURES, httpx.HTTPError) as exc:
            logger.warning("No se vinculó el número de avisos: %s", exc)
            raise NoticeSenderNotLinked(str(exc)) from exc


class TeamDirectory:
    """El responsable se guarda en la cita por nombre: el formulario ofrece
    los nombres del equipo."""

    async def recipients(self, seller_name: str) -> list[dict]:
        wanted = seller_name.strip().casefold()
        team = await list_active_sellers()
        ids = [
            member["id"] for member in team
            if member["role"] == "admin" or (wanted and member["name"].strip().casefold() == wanted)
        ]
        phones = await staff_phones(ids)
        names = {member["id"]: member["name"] for member in team}
        return [{"id": user_id, "name": names[user_id], "phone": phones.get(user_id)} for user_id in ids]

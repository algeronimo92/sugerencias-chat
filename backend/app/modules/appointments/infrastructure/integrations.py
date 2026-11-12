"""Los conectores externos de las citas: Google Calendar, el workflow de
citas de n8n y el envío por WhatsApp de los avisos de cita."""

from __future__ import annotations

import httpx

from app.integrations.google_calendar import create_google_event
from app.integrations.n8n.client import post_form
from app.modules.appointments.domain.appointment import SyncResult
from app.modules.appointments.domain.calendar_event import EventContent
from app.integrations.whatsapp.channel import SEND_FAILURES
from app.integrations.whatsapp.channels import current_channel
from app.modules.appointments.domain.errors import NoticeNotSent
from app.modules.auth.ports.users import list_active_sellers, staff_phones
from app.modules.conversations.ports.template_sending import (
    ChatMessagingError,
    official_template_message,
    send_template,
)
from app.modules.platform.ports.settings_service import get_effective

REQUEST_TIMEOUT_SECONDS = 60.0


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

    async def send_to_phone(self, *, phone: str, template: dict, parameters: list[str]) -> str | None:
        try:
            message = await official_template_message(template, parameters)
            receipt = await current_channel().sender.send_to_number(phone, message)
        except (ChatMessagingError, *SEND_FAILURES) as exc:
            raise NoticeNotSent(str(exc)) from exc
        return receipt.provider_message_id


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

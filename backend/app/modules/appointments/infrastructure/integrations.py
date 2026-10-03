"""Los conectores externos de las citas: Google Calendar y el workflow de
citas de n8n."""

from __future__ import annotations

import httpx

from app.integrations.google_calendar import create_google_event
from app.integrations.n8n.client import post_form
from app.modules.appointments.domain.appointment import SyncResult
from app.modules.platform.ports.settings_service import get_effective

REQUEST_TIMEOUT_SECONDS = 60.0


class GoogleCalendar:
    async def create_event(self, appointment: dict, field_labels: dict[str, str]) -> dict:
        return await create_google_event(appointment, field_labels)


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

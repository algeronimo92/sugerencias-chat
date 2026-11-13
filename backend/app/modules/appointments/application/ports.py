"""Puertos de las citas: dónde se guardan, el calendario externo, el
sincronizador de n8n, cómo se encuentra el lead de un teléfono y cómo se le
escribe al cliente."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Protocol

from app.modules.appointments.domain.appointment import SyncResult
from app.modules.appointments.domain.calendar_event import EventContent


class AppointmentRepository(Protocol):
    async def add(self, values: dict) -> dict: ...

    async def get(self, appointment_id: int) -> dict | None: ...

    async def latest_real(self) -> dict | None:
        """La última cita que no es de prueba (para las vistas previas)."""

    async def record_integrations(self, appointment_id: int, **values) -> dict:
        """Guarda el resultado de las integraciones. ``clear_calendar_sync_error``
        borra un error anterior del calendario."""


class CalendarProvider(Protocol):
    async def create_event(self, appointment: dict, content: EventContent) -> dict:
        """El evento de la cita con el título y la descripción ya armados.
        ``{status, event_id, event_link, error}``; ``status`` es
        ``synced``, ``not_configured`` o ``error``. Nunca levanta."""


class AppointmentSync(Protocol):
    async def submit(self, *, test_mode: bool, form: dict, files: dict | None) -> SyncResult: ...


class AppointmentLeads(Protocol):
    async def by_whatsapp_identity(self, e164: str) -> str | None: ...

    async def by_phone_tail(self, tail: str) -> str | None:
        """El único lead cuyo teléfono termina en ``tail``; None si no hay
        ninguno o hay más de uno."""

    async def exists(self, lead_id: str) -> bool: ...

    async def snapshot(self, lead_id: str) -> dict | None:
        """La fila del lead (nombre, teléfono, campos personalizados…), o None."""

    async def register(
        self, lead_id: str, *, actor_user_id: int, appointment: dict,
        starts_at: datetime | None, updates: dict[str, Any], custom_fields: dict[str, Any],
        note: str,
    ) -> None:
        """Le cuenta al lead que se le agendó la cita, dentro de la
        transacción en curso (ver ``leads.register_appointment``), y le deja
        ``note`` como nota interna a nombre de quien agendó."""


class NoticeMessenger(Protocol):
    async def send_to_lead(
        self, *, chat_id: str, template_id: int, parameters: list[str], user_id: int, dedupe_key: str,
    ) -> int | None:
        """Encola la plantilla oficial en el chat del lead y devuelve el id
        del mensaje en el CRM. Levanta ``NoticeNotSent`` si no se pudo."""

    async def send_to_phone(
        self, *, phone: str, template: dict, parameters: list[str], sender: str | None = None,
    ) -> str | None:
        """Manda la plantilla directo a un número del equipo, sin abrir un
        chat en el CRM, y devuelve el id que le dio Meta. ``sender`` es el
        número de avisos (su phone number id); sin él sale del número del
        CRM. Levanta ``NoticeNotSent`` si Meta no la aceptó."""

    async def send_to_lead_from(
        self, *, chat_id: str, template: dict, parameters: list[str], sender: str,
    ) -> str | None:
        """Manda la plantilla al WhatsApp del lead desde el número de avisos,
        sin pasar por su chat (el cliente la recibe de otro número: en el
        chat del CRM sería una conversación que no existe). Devuelve el id
        que le dio Meta. Levanta ``NoticeNotSent`` si no salió."""


class NoticeSenders(Protocol):
    async def numbers(self, extra_waba_id: str | None = None) -> list[dict]:
        """Los números de la WABA del CRM y, si se pasa, los de la WABA del
        número de avisos: ``{id, display_phone_number, verified_name,
        waba_id, is_crm}``. Levanta ``NoticeAccountUnavailable`` si Meta no respondió
        por la WABA del CRM."""

    async def account_name(self, waba_id: str) -> str:
        """El nombre de la cuenta de WhatsApp Business en Meta ("" si no se
        pudo leer)."""

    async def register(self, phone_number_id: str, waba_id: str | None = None) -> None:
        """Deja que los estados de entrega de ese número (y los eventos de
        plantillas de su WABA) lleguen al negocio."""

    async def unregister(self, phone_number_id: str) -> None:
        """Deja de recibir los webhooks del número que dejó de ser el de avisos."""

    async def complete_signup(self, code: str, waba_id: str, phone_number_id: str | None) -> dict[str, str]:
        """Cierra el Embedded Signup (con coexistencia o sin ella) de un número
        nuevo sin tocar las credenciales del CRM, y devuelve
        ``{phone_number_id, waba_id}``. Levanta ``NoticeSenderNotLinked`` si
        Meta no lo dejó vinculado en el portfolio del negocio."""

    async def templates(self, waba_id: str) -> list[dict]:
        """Las plantillas de una WABA en Meta: ``{id, name, language, status}``.
        Levanta ``NoticeAccountUnavailable`` si Meta no respondió."""

    async def copy_template(self, meta_template_id: str, waba_id: str) -> None:
        """Crea en esa WABA una copia de una plantilla de la WABA del CRM, que
        Meta revisa de nuevo. Levanta ``NoticeAccountUnavailable`` si Meta la rechazó."""


class StaffDirectory(Protocol):
    async def recipients(self, seller_name: str) -> list[dict]:
        """``{id, name, phone}`` del responsable de la cita (por nombre) y de
        los admins activos, sin repetir. ``phone`` es None si no lo cargaron:
        el aviso queda registrado como no enviado por eso."""


class NoticeLog(Protocol):
    async def record(self, appointment_id: int, notices: list[dict]) -> None:
        """Guarda los avisos que generó la cita (ver ``AppointmentNotice``)."""

    async def record_delivery(
        self, *, provider_message_id: str | None, wsp_message_id: int | None, status: str, at: datetime | None,
    ) -> int:
        """Marca como enviado, entregado, leído o fallido el aviso de ese
        mensaje, sin volver atrás (un leído no pasa a entregado). Devuelve
        cuántos avisos cambiaron."""


@dataclass(frozen=True)
class AppointmentPorts:
    repository: AppointmentRepository
    calendar: CalendarProvider
    sync: AppointmentSync
    leads: AppointmentLeads
    messenger: NoticeMessenger
    staff: StaffDirectory
    notices: NoticeLog
    senders: NoticeSenders


_ports: AppointmentPorts | None = None


def provide_appointment_ports(ports: AppointmentPorts) -> None:
    global _ports
    _ports = ports


def appointment_ports() -> AppointmentPorts:
    if _ports is None:
        raise RuntimeError("Los puertos de citas no están configurados (app.composition)")
    return _ports

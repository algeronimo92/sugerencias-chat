"""Casos de uso de citas. La fila local se confirma antes de tocar los
conectores: un Google o un n8n caídos nunca hacen perder una cita."""

from __future__ import annotations

import logging

from app.core.phone_utils import PhoneValidationError, normalize_phone
from app.db.uow import collect, unit_of_work
from app.modules.appointments.application.ports import appointment_ports
from app.modules.appointments.domain.appointment import (
    PHONE_TAIL_DIGITS,
    SKIPPED_CALENDAR,
    AppointmentRequest,
    LeadLink,
    announcement,
    lead_note,
    outcome,
)
from app.modules.appointments.domain.errors import (
    AppointmentLeadNotFound,
    AppointmentNotFound,
    CalendarNotConfigured,
    CalendarSyncFailed,
    TestAppointmentNotSynced,
)
from app.modules.appointments.domain.events import AppointmentCreated
from app.modules.appointments.application.calendar_template import event_content
from app.modules.platform.public import business_timezone, effective_country_code

logger = logging.getLogger(__name__)


async def resolve_lead_for_phone(telefono: str) -> str | None:
    """El lead dueño de ese teléfono, o None si no se puede afirmar cuál es.

    Primero por la identidad de WhatsApp (el ``wa_id`` es el E.164 en dígitos),
    que es la identidad canónica del CRM; si el número nunca chateó, cae a
    comparar la cola del teléfono contra los leads, y **solo** acepta el
    resultado cuando un único lead coincide. Con dos candidatos devuelve None a
    propósito: una cita colgada del lead equivocado es peor que una cita sin
    vincular.
    """
    try:
        e164 = normalize_phone(telefono, await effective_country_code())
    except PhoneValidationError:
        return None
    except Exception:
        # La resolución del lead es un extra sobre el registro de la cita; que
        # falle no puede impedir que la cita se guarde.
        logger.exception("No se pudo normalizar el teléfono de la cita")
        return None

    leads = appointment_ports().leads
    lead_id = await leads.by_whatsapp_identity(e164)
    if lead_id is not None:
        return lead_id
    tail = e164[-PHONE_TAIL_DIGITS:]
    if len(tail) < PHONE_TAIL_DIGITS:
        return None
    return await leads.by_phone_tail(tail)


async def create_appointment(
    request: AppointmentRequest,
    *,
    created_by_user_id: int,
    files: dict | None,
    lead: LeadLink | None = None,
) -> dict:
    """Con ``lead`` la cita se agendó desde la ficha: va atada a ese lead y,
    salvo en modo prueba, el lead se entera en la misma transacción (próxima
    cita, actividad, nota interna, etapa y los datos que el vendedor corrigió). Sin él, el
    lead se adivina por teléfono y no se toca."""
    ports = appointment_ports()
    if lead is not None:
        if not await ports.leads.exists(lead.lead_id):
            raise AppointmentLeadNotFound()
        lead_id = lead.lead_id
    else:
        lead_id = await resolve_lead_for_phone(request.telefono)
    async with unit_of_work():
        appointment = await ports.repository.add(request.record(
            created_by_user_id=created_by_user_id, lead_id=lead_id,
        ))
        if lead is not None and not request.test_mode:
            await ports.leads.register(
                lead.lead_id, actor_user_id=created_by_user_id, appointment=appointment,
                starts_at=request.starts_at(await business_timezone()),
                updates=lead.updates, custom_fields=lead.custom_fields,
                note=lead_note(appointment),
            )

    calendar = (
        SKIPPED_CALENDAR if request.test_mode
        else await ports.calendar.create_event(appointment, await event_content(appointment))
    )
    appointment = await ports.repository.record_integrations(
        appointment["id"], event_link=calendar["event_link"],
        calendar_event_id=calendar["event_id"],
        calendar_sync_status=calendar["status"],
        calendar_sync_error=calendar["error"],
    )
    sync = await ports.sync.submit(test_mode=request.test_mode, form=request.n8n_form(), files=files)
    result = outcome(calendar, sync, appointment.get("event_link"))

    async with unit_of_work():
        appointment = await ports.repository.record_integrations(
            appointment["id"], status=result.status, n8n_status=result.n8n_status,
            message=result.message, event_link=result.event_link,
        )
        if not request.test_mode:
            title, text = announcement(appointment)
            collect(AppointmentCreated(
                appointment_id=appointment["id"], created_by_user_id=created_by_user_id, title=title, text=text,
            ))
    return {
        **result.payload, "success": True, "message": result.message,
        "appointment": appointment, "eventLink": result.event_link,
        "calendarSyncStatus": appointment["calendar_sync_status"],
        "integrationErrors": result.integration_errors,
    }


async def sync_calendar(appointment_id: int) -> dict:
    """Manda al calendario una cita que no llegó (o que se cargó antes de
    activar la integración)."""
    ports = appointment_ports()
    appointment = await ports.repository.get(appointment_id)
    if appointment is None:
        raise AppointmentNotFound()
    if appointment["test_mode"]:
        raise TestAppointmentNotSynced()
    if appointment["calendar_sync_status"] == "synced" and appointment["calendar_event_id"]:
        return appointment

    result = await ports.calendar.create_event(appointment, await event_content(appointment))
    updated = await ports.repository.record_integrations(
        appointment_id,
        event_link=result["event_link"],
        calendar_event_id=result["event_id"],
        calendar_sync_status=result["status"],
        calendar_sync_error=result["error"],
        clear_calendar_sync_error=result["status"] == "synced",
    )
    if result["status"] == "not_configured":
        raise CalendarNotConfigured()
    if result["status"] == "error":
        raise CalendarSyncFailed(result["error"])
    return updated

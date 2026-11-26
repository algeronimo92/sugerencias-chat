"""Contrato HTTP de citas; los efectos de negocio viven en
application/commands.py y los errores de dominio los traduce bootstrap."""

import base64

from fastapi import APIRouter, Depends, HTTPException

from app.modules.appointments.application import calendar_template, commands, notice, reminders
from app.modules.appointments.domain.notice import Audience
from app.modules.appointments.domain.appointment import CUSTOM_ADELANTO_KEY, AppointmentRequest, LeadLink
from app.modules.appointments.queries import get_appointment, list_appointments
from app.modules.catalogs.ports.custom_fields import (CustomFieldError, normalize_values)
from app.modules.auth.public import User
from app.modules.appointments.schemas import (
    AppointmentCreate,
    AppointmentCreated,
    AppointmentDismiss,
    AppointmentItem,
    CalendarEventTemplate,
    CalendarEventTemplateUpdate,
    NoticeRetryResult,
    NoticeSender,
    NoticeSenderSignup,
    NoticeSenderUpdate,
    NoticeSettings,
    NoticeSettingsUpdate,
    ReminderSettings,
    ReminderSettingsUpdate,
)
from app.modules.auth.public import Permission, can, require_permission
from app.modules.media.ports.media_upload import (normalize_media_content_type)
from app.core.phone_utils import PhoneValidationError, normalize_phone
from app.modules.platform.public import effective_country_code
from app.modules.auth.public import list_active_sellers
from app.modules.leads.ports.visibility import ensure_lead_visible, seller_scope

require_appointments_view = require_permission(Permission.APPOINTMENTS_VIEW)
require_appointments_edit = require_permission(Permission.APPOINTMENTS_EDIT)
require_appointments_manage = require_permission(Permission.APPOINTMENTS_MANAGE)
require_appointments_configure = require_permission(Permission.APPOINTMENTS_CONFIGURE)

router = APIRouter(prefix="/api/appointments", tags=["appointments"])

ALLOWED_COMPROBANTE_TYPES = {"image/jpeg", "image/png", "application/pdf"}
MAX_COMPROBANTE_BYTES = 10 * 1024 * 1024


async def _active_seller_names() -> set[str]:
    return {str(seller["name"]).strip() for seller in await list_active_sellers()}


@router.get("", response_model=list[AppointmentItem])
async def get_appointments(user: User = Depends(require_appointments_view)):
    return await list_appointments(owner_id=await seller_scope(user))


@router.get("/calendar-template", response_model=CalendarEventTemplate)
async def get_calendar_template(_user: User = Depends(require_appointments_configure)):
    return await calendar_template.get_template()


@router.put("/calendar-template", response_model=CalendarEventTemplate)
async def put_calendar_template(body: CalendarEventTemplateUpdate, _user: User = Depends(require_appointments_configure)):
    return await calendar_template.save_template(body.title_template, body.description_template)


@router.get("/notice-sender", response_model=NoticeSender)
async def get_notice_sender(user: User = Depends(require_appointments_configure)):
    return await notice.get_sender(user.id)


@router.put("/notice-sender", response_model=NoticeSender)
async def put_notice_sender(body: NoticeSenderUpdate, user: User = Depends(require_appointments_configure)):
    return await notice.save_sender(body.phone_number_id, user.id)


@router.post("/notice-sender/embedded-signup", response_model=NoticeSender)
async def post_notice_sender_signup(body: NoticeSenderSignup, user: User = Depends(require_appointments_configure)):
    return await notice.link_sender(body.code, body.waba_id, body.phone_number_id, user.id, mode=body.mode)


@router.post("/notice-sender/templates", response_model=NoticeSender)
async def post_notice_sender_templates(user: User = Depends(require_appointments_configure)):
    """Copia a la cuenta del número de avisos las plantillas de los avisos
    que todavía no están ahí."""
    return await notice.copy_templates(user.id)


@router.get("/notices/{audience}", response_model=NoticeSettings)
async def get_notice(audience: Audience, user: User = Depends(require_appointments_configure)):
    return await notice.get_settings(audience, user.id)


@router.put("/notices/{audience}", response_model=NoticeSettings)
async def put_notice(audience: Audience, body: NoticeSettingsUpdate, user: User = Depends(require_appointments_configure)):
    return await notice.save_settings(
        audience, enabled=body.enabled, template_id=body.template_id, parameters=body.parameters, user_id=user.id,
    )


@router.get("/reminders", response_model=ReminderSettings)
async def get_reminders(user: User = Depends(require_appointments_configure)):
    return await reminders.get_settings(user.id)


@router.put("/reminders", response_model=ReminderSettings)
async def put_reminders(body: ReminderSettingsUpdate, user: User = Depends(require_appointments_configure)):
    return await reminders.save_settings(
        include_manual_events=body.include_manual_events,
        reminders=[item.model_dump() for item in body.reminders],
        user_id=user.id,
    )


@router.post("/{appointment_id}/sync-calendar", response_model=AppointmentItem)
async def sync_appointment_calendar(
    appointment_id: int,
    user: User = Depends(require_appointments_edit),
):
    await _ensure_appointment_visible(user, appointment_id)
    return await commands.sync_calendar(appointment_id)


@router.post("/{appointment_id}/notices/retry", response_model=NoticeRetryResult)
async def retry_appointment_notices(
    appointment_id: int,
    user: User = Depends(require_appointments_edit),
):
    """Vuelve a mandar los avisos de WhatsApp de la cita que fallaron."""
    await _ensure_appointment_visible(user, appointment_id)
    return await notice.retry_failed_notices(appointment_id)


async def _ensure_appointment_visible(user: User, appointment_id: int) -> None:
    if await seller_scope(user) is None:
        return
    appointment = await get_appointment(appointment_id)
    if appointment is None:
        raise HTTPException(404, "Cita no encontrada")
    if appointment["lead_id"] is not None:
        await ensure_lead_visible(user, appointment["lead_id"])
    elif appointment["created_by_user_id"] != user.id:
        raise HTTPException(404, "Cita no encontrada")


@router.post("/{appointment_id}/dismiss", response_model=AppointmentItem)
async def dismiss_appointment(appointment_id: int, body: AppointmentDismiss, user: User = Depends(require_appointments_manage)):
    """Sacar una cita de las cifras de ventas es decidir qué plata entró, no
    algo que haga quien la registró: por eso es un permiso aparte."""
    return await commands.dismiss(appointment_id, user_id=user.id, reason=body.reason)


@router.post("/{appointment_id}/restore", response_model=AppointmentItem)
async def restore_appointment(appointment_id: int, _user: User = Depends(require_appointments_manage)):
    return await commands.restore(appointment_id)


def _attachment(body: AppointmentCreate):
    if body.comprobante is None:
        return None
    content_type = normalize_media_content_type(body.comprobante.content_type, body.comprobante.filename)
    if content_type not in ALLOWED_COMPROBANTE_TYPES:
        raise HTTPException(400, "El comprobante debe ser una imagen JPG/PNG o un PDF")
    try:
        raw = base64.b64decode(body.comprobante.data_base64, validate=True)
    except Exception as exc:
        raise HTTPException(400, "El comprobante no es un archivo válido") from exc
    if not raw:
        raise HTTPException(400, "El comprobante está vacío")
    if len(raw) > MAX_COMPROBANTE_BYTES:
        raise HTTPException(413, "El comprobante supera el máximo de 10 MB")
    return {"Comprobante": (body.comprobante.filename, raw, content_type)}


@router.post("", response_model=AppointmentCreated)
async def post_appointment(body: AppointmentCreate, user: User = Depends(require_appointments_edit)):
    if body.lead_id is not None:
        await ensure_lead_visible(user, body.lead_id)
    elif await seller_scope(user) is not None:
        # La carga desde Citas también puede encontrar un lead por teléfono.
        matched = await commands.resolve_lead_for_phone(body.telefono)
        if matched is not None:
            await ensure_lead_visible(user, matched)
    try:
        normalize_phone(body.telefono, await effective_country_code())
    except PhoneValidationError as exc:
        raise HTTPException(400, str(exc)) from exc
    if body.vendedor.strip() not in await _active_seller_names():
        raise HTTPException(400, "Vendedor inválido: elige un usuario activo del equipo")
    if body.test_mode and not can(user, Permission.APPOINTMENTS_MANAGE):
        raise HTTPException(403, "Tu rol no puede enviar citas en modo prueba")
    try:
        custom_fields = await normalize_values("appointment", body.custom_fields, require_required=True)
    except CustomFieldError as exc:
        raise HTTPException(422, str(exc)) from exc
    # El campo personalizado "adelanto" es un número libre, pero es plata que
    # dejó la clienta: un negativo es un error de tipeo que después restaría en
    # los montos del dashboard. El campo fijo ya lo impide en el esquema.
    deposit = custom_fields.get(CUSTOM_ADELANTO_KEY)
    if isinstance(deposit, (int, float)) and not isinstance(deposit, bool) and deposit < 0:
        raise HTTPException(422, "Adelanto: no puede ser negativo")

    lead = await _lead_link(body)
    files = _attachment(body)
    request = AppointmentRequest(
        nombre_completo=body.nombre_completo, telefono=body.telefono, tratamiento=body.tratamiento,
        fecha=body.fecha, hora=body.hora, vendedor=body.vendedor, dni=body.dni, detalle=body.detalle,
        adelanto=body.adelanto, duration_minutes=body.duration_minutes, custom_fields=custom_fields,
        comprobante_filename=body.comprobante.filename if body.comprobante else None,
        test_mode=body.test_mode, client_request_id=body.client_request_id,
    )
    return await commands.create_appointment(request, created_by_user_id=user.id, files=files, lead=lead)


async def _lead_link(body: AppointmentCreate) -> LeadLink | None:
    if body.lead_id is None:
        if body.lead_updates is not None:
            raise HTTPException(400, "Los cambios al lead requieren el lead de la cita")
        return None
    changes = body.lead_updates
    if changes is None:
        return LeadLink(body.lead_id)
    try:
        custom_fields = await normalize_values("lead", changes.custom_fields, require_required=False)
    except CustomFieldError as exc:
        raise HTTPException(422, str(exc)) from exc
    updates = {
        key: value.strip()
        for key, value in (("nombre", changes.nombre), ("servicio_interes", changes.servicio_interes))
        if value is not None and value.strip()
    }
    return LeadLink(body.lead_id, updates=updates, custom_fields=custom_fields)

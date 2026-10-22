"""Contrato HTTP de citas; los efectos de negocio viven en
application/commands.py y los errores de dominio los traduce bootstrap."""

import base64

from fastapi import APIRouter, Depends, HTTPException

from app.modules.appointments.application import commands
from app.modules.appointments.domain.appointment import AppointmentRequest
from app.modules.appointments.queries import list_appointments
from app.modules.catalogs.ports.custom_fields import (CustomFieldError, normalize_values)
from app.modules.auth.public import User
from app.modules.appointments.schemas import AppointmentCreate, AppointmentCreated, AppointmentItem
from app.modules.auth.public import get_current_user
from app.modules.media.ports.media_upload import (normalize_media_content_type)
from app.core.phone_utils import PhoneValidationError, normalize_phone
from app.modules.platform.public import effective_country_code
from app.modules.auth.public import list_active_sellers

router = APIRouter(prefix="/api/appointments", tags=["appointments"])

ALLOWED_COMPROBANTE_TYPES = {"image/jpeg", "image/png", "application/pdf"}
MAX_COMPROBANTE_BYTES = 10 * 1024 * 1024


async def _active_seller_names() -> set[str]:
    return {str(seller["name"]).strip() for seller in await list_active_sellers()}


@router.get("", response_model=list[AppointmentItem])
async def get_appointments(_user: User = Depends(get_current_user)):
    return await list_appointments()


@router.post("/{appointment_id}/sync-calendar", response_model=AppointmentItem)
async def sync_appointment_calendar(
    appointment_id: int,
    _user: User = Depends(get_current_user),
):
    return await commands.sync_calendar(appointment_id)


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
async def post_appointment(body: AppointmentCreate, user: User = Depends(get_current_user)):
    try:
        normalize_phone(body.telefono, await effective_country_code())
    except PhoneValidationError as exc:
        raise HTTPException(400, str(exc)) from exc
    if body.vendedor.strip() not in await _active_seller_names():
        raise HTTPException(400, "Vendedor inválido: elegí un usuario activo del equipo")
    if body.test_mode and user.role != "admin":
        raise HTTPException(403, "Solo un administrador puede enviar en modo prueba")
    try:
        custom_fields = await normalize_values("appointment", body.custom_fields, require_required=True)
    except CustomFieldError as exc:
        raise HTTPException(422, str(exc)) from exc

    files = _attachment(body)
    request = AppointmentRequest(
        nombre_completo=body.nombre_completo, telefono=body.telefono, tratamiento=body.tratamiento,
        fecha=body.fecha, hora=body.hora, vendedor=body.vendedor, dni=body.dni, detalle=body.detalle,
        adelanto=body.adelanto, duration_minutes=body.duration_minutes, custom_fields=custom_fields,
        comprobante_filename=body.comprobante.filename if body.comprobante else None,
        test_mode=body.test_mode,
    )
    return await commands.create_appointment(request, created_by_user_id=user.id, files=files)

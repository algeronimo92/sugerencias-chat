"""Envío de las citas al ERP del negocio, para que aparezcan en su agenda.

Como con Google Calendar y n8n, la cita local es la fuente de verdad: se
guarda primero y un ERP caído solo deja la cita marcada para reintentar. Lo
único que sí frena el alta es que falte un dato que el ERP exige (el DNI, o
el método de pago de un adelanto): sin él la cita nunca podría llegar.
"""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime, tzinfo

from app.core.errors import Invalid
from app.modules.appointments.application.ports import appointment_ports
from app.modules.appointments.domain.appointment import AppointmentRequest
from app.modules.appointments.domain.erp_push import (
    ERP_NOT_CONFIGURED,
    Receipt,
    choose_package,
    erp_error,
    erp_form,
    missing_for_erp,
)
from app.modules.appointments.domain.errors import (
    AppointmentNotFound,
    DismissedAppointmentNotSentToErp,
    ErpDataRequired,
    ErpNotConfigured,
    ErpSyncFailed,
    TestAppointmentNotSentToErp,
)
from app.modules.platform.public import business_timezone


def _missing(dni: str | None, adelanto, payment_method: str | None) -> str | None:
    missing = missing_for_erp(dni=dni, adelanto=adelanto, payment_method=payment_method)
    return "Para enviar la cita al ERP falta " + " y ".join(missing) if missing else None


async def prepare(request: AppointmentRequest, receipt: Receipt | None) -> AppointmentRequest:
    """La cita lista para el ERP: con lo que este exige, el paquete del
    catálogo resuelto y el comprobante guardado. Solo con el envío activo.

    Un servicio que no está en el ERP (cargado a mano en el CRM) no frena la
    venta: la cita se guarda sin paquete y queda marcada como no enviada.
    """
    ports = appointment_ports()
    missing = _missing(request.effective_dni, request.effective_adelanto, request.payment_method)
    if missing:
        raise ErpDataRequired(missing)
    package = choose_package(await ports.catalog.packages(request.tratamiento), request.package_id)
    if package is not None:
        request = replace(request, erp_package_id=package["external_id"], package_name=package["name"])
    if receipt is not None:
        request = replace(request, comprobante_url=await ports.receipts.save(receipt))
    return request


def _starts_at(appointment: dict, timezone: tzinfo) -> datetime | None:
    try:
        return datetime.fromisoformat(f"{appointment['fecha']}T{appointment['hora'].strip()}").replace(tzinfo=timezone)
    except (ValueError, AttributeError):
        return None


async def push(appointment: dict, receipt: Receipt | None = None) -> dict:
    """Manda la cita guardada. ``{status, erp_appointment_id, erp_link,
    error}``; nunca levanta. ``receipt`` evita releer el comprobante recién
    subido; en un reintento se toma el guardado."""
    ports = appointment_ports()
    if not await ports.erp.active():
        return dict(ERP_NOT_CONFIGURED)
    if not appointment.get("erp_package_id"):
        return erp_error(
            f"«{appointment['tratamiento']}» no tiene un paquete en el catálogo del ERP: "
            "créalo en el ERP y sincroniza el catálogo"
        )
    missing = _missing(appointment.get("dni"), appointment.get("adelanto"), appointment.get("payment_method"))
    if missing:
        return erp_error(missing)
    starts_at = _starts_at(appointment, await business_timezone())
    if starts_at is None:
        return erp_error("La hora de la cita no se puede leer")

    has_deposit = float(appointment.get("adelanto") or 0) > 0
    if not has_deposit:
        receipt = None
    elif receipt is None and appointment.get("comprobante_url"):
        receipt = await ports.receipts.load(appointment["comprobante_url"], appointment.get("comprobante_filename"))

    form = erp_form(
        appointment,
        external_id=await ports.erp.external_id(appointment["id"]),
        starts_at=starts_at,
        seller_email=await ports.staff.email_for(appointment["vendedor"], appointment.get("created_by_user_id")),
    )
    return await ports.erp.push(form, receipt)


async def record(appointment_id: int, result: dict) -> dict:
    return await appointment_ports().repository.record_integrations(
        appointment_id,
        erp_appointment_id=result["erp_appointment_id"],
        erp_link=result["erp_link"],
        erp_sync_status=result["status"],
        erp_sync_error=result["error"],
        clear_erp_sync_error=result["status"] == "synced",
    )


async def sync_erp(appointment_id: int) -> dict:
    """Manda al ERP una cita que no llegó (o que se cargó antes de activar el
    envío). Repetirlo es seguro: el ERP reconoce la cita y no la duplica."""
    ports = appointment_ports()
    appointment = await ports.repository.get(appointment_id)
    if appointment is None:
        raise AppointmentNotFound()
    if appointment["test_mode"]:
        raise TestAppointmentNotSentToErp()
    if appointment.get("dismissed_at"):
        raise DismissedAppointmentNotSentToErp()
    if appointment.get("erp_sync_status") == "synced" and appointment.get("erp_appointment_id"):
        return appointment
    if not await ports.erp.active():
        raise ErpNotConfigured()

    if not appointment.get("erp_package_id"):
        # Agendada antes de activar el envío, o cuando el servicio todavía no
        # estaba en el ERP: ahora puede que sí tenga paquete.
        package = choose_package(await ports.catalog.packages(appointment["tratamiento"]), None)
        if package is not None:
            appointment = await ports.repository.record_integrations(
                appointment_id, erp_package_id=package["external_id"], package_name=package["name"],
            )

    result = await push(appointment)
    updated = await record(appointment_id, result)
    if result["status"] == "not_configured":
        raise ErpNotConfigured()
    if result["status"] == "error":
        raise ErpSyncFailed(result["error"])
    return updated


async def get_config(*, is_admin: bool) -> dict:
    """Lo que el formulario necesita saber (si el envío está activo) y, para
    el admin, la conexión cargada. La dirección solo la ve el admin."""
    erp = appointment_ports().erp
    config = await erp.config()
    return {
        "active": await erp.active(),
        "enabled": config["enabled"],
        "url": config["url"] if is_admin else None,
        "token_configured": config["token_configured"],
        "catalog_connected": config["catalog_connected"],
    }


async def save_config(*, enabled: bool, url: str, token: str | None) -> dict:
    erp = appointment_ports().erp
    token = (token or "").strip() or None
    current = await erp.config()
    if enabled and not url.strip():
        raise Invalid("Para activar el envío de citas falta la dirección del ERP")
    if enabled and token is None and not current["token_configured"]:
        raise Invalid("Para activar el envío de citas falta el token del ERP")
    try:
        await erp.save_config(enabled=enabled, url=url, token=token)
    except ValueError as exc:
        raise Invalid(str(exc)) from exc
    return await get_config(is_admin=True)


async def test_connection(url: str | None, token: str | None) -> dict:
    return await appointment_ports().erp.ping(url, token)

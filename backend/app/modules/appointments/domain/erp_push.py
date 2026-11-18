"""La cita vista por el ERP del negocio: qué necesita para aceptarla, qué
paquete del catálogo le corresponde y el formulario que se le manda.

El ERP crea con eso una cita real en su agenda: paciente (por DNI), paquete
nuevo con su primera sesión y, si hubo adelanto, el pago con su comprobante.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Any

# Los métodos con que el ERP registra un pago que entra. No incluye su
# ``account_credit``: ese es saldo que ya está en el ERP.
PAYMENT_METHODS = ("cash", "card", "transfer", "yape", "plin")

# El ERP identifica al paciente por DNI y su ficha solo admite 8 dígitos.
DNI_RE = re.compile(r"^\d{8}$")

ERP_NOT_CONFIGURED = {"status": "not_configured", "erp_appointment_id": None, "erp_link": None, "error": None}
ERP_SKIPPED = {"status": "skipped", "erp_appointment_id": None, "erp_link": None, "error": None}


@dataclass(frozen=True)
class Receipt:
    """El comprobante del adelanto, tal como lo subió el vendedor."""

    filename: str
    content: bytes
    content_type: str


def erp_error(message: str) -> dict:
    return {"status": "error", "erp_appointment_id": None, "erp_link": None, "error": message}


def clean_dni(dni: str | None) -> str:
    return re.sub(r"[\s.\-]", "", dni or "")


def _amount(value: Any) -> Decimal:
    try:
        return Decimal(str(value or 0))
    except (InvalidOperation, ValueError):
        return Decimal(0)


def missing_for_erp(*, dni: str | None, adelanto: Any, payment_method: str | None) -> list[str]:
    """Lo que le falta a la cita para que el ERP la acepte, en palabras del
    formulario. Vale igual al agendar que al reintentar un envío."""
    missing = []
    if not DNI_RE.fullmatch(clean_dni(dni)):
        missing.append("el DNI del cliente (8 dígitos)")
    if _amount(adelanto) > 0 and payment_method not in PAYMENT_METHODS:
        missing.append("el método de pago del adelanto")
    return missing


def choose_package(packages: list[dict], package_id: int | None) -> dict | None:
    """El paquete de la cita entre los que el servicio tiene en el ERP.

    Sin ``package_id`` (el formulario no lo mandó: una versión vieja en caché,
    o un reintento de una cita anterior a la integración) va el de menos
    sesiones: la cita del CRM es casi siempre una primera sesión y, si se
    vendió otro, se corrige en el ERP. Un ``package_id`` que no es de ese
    servicio no se adivina: None.
    """
    sellable = [package for package in packages if package.get("external_id")]
    if package_id is not None:
        return next((package for package in sellable if package["id"] == package_id), None)
    if not sellable:
        return None
    return min(sellable, key=lambda package: (package["sessions"], package.get("position", 0), package["id"]))


def erp_form(appointment: dict, *, external_id: str, starts_at: datetime, seller_email: str | None) -> dict[str, str]:
    """Los campos de ``POST /api/integrations/crm/appointments`` del ERP.

    El precio no viaja: lo pone el ERP, porque el catálogo del CRM puede ir
    una hora atrás del suyo. El adelanto y su método van juntos o no van.
    """
    form = {
        "externalId": external_id,
        "patientName": appointment["nombre_completo"],
        "patientDni": clean_dni(appointment.get("dni")),
        "patientPhone": re.sub(r"\D", "", appointment.get("telefono") or ""),
        "servicePackageId": appointment["erp_package_id"],
        # Con offset: sin él el ERP no sabría en qué zona está la hora.
        "scheduledDate": starts_at.isoformat(),
        "durationMinutes": str(appointment.get("duration_minutes") or 60),
        "sellerName": appointment.get("vendedor") or "",
        "sellerEmail": seller_email or "",
        "notes": appointment.get("detalle") or "",
    }
    amount = _amount(appointment.get("adelanto"))
    if amount > 0:
        form["reservationAmount"] = f"{amount:.2f}"
        form["reservationPaymentMethod"] = appointment.get("payment_method") or ""
    return {key: value for key, value in form.items() if value != ""}


def erp_appointment_link(base_url: str, erp_appointment_id: str) -> str:
    """La cita en la pantalla del ERP: la misma dirección sirve su app y su API."""
    return f"{base_url.rstrip('/')}/appointments/{erp_appointment_id}"

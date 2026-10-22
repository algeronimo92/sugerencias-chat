"""Una cita: lo que se pidió, lo que se le manda a n8n y en qué estado queda
según cómo respondieron las integraciones.

La cita local es la fuente de verdad. Google Calendar y n8n son extras: si
fallan, la cita igual queda guardada y el error se informa junto a ella.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

# Cola del número que se compara contra los leads cuando el teléfono no es una
# identidad de WhatsApp conocida: en Perú son los 9 dígitos del celular, sin el
# código de país. Alcanza para emparejar un teléfono escrito con o sin +51.
PHONE_TAIL_DIGITS = 9


@dataclass(frozen=True)
class AppointmentRequest:
    nombre_completo: str
    telefono: str
    tratamiento: str
    fecha: str
    hora: str
    vendedor: str
    dni: str = ""
    detalle: str = ""
    adelanto: float = 0
    duration_minutes: int = 60
    custom_fields: dict[str, Any] = field(default_factory=dict)
    comprobante_filename: str | None = None
    test_mode: bool = False

    def record(self, *, created_by_user_id: int, lead_id: str | None) -> dict:
        """Los valores con los que se guarda la cita, antes de cualquier
        integración."""
        return {
            "created_by_user_id": created_by_user_id,
            "lead_id": lead_id,
            "nombre_completo": self.nombre_completo,
            "dni": self.dni,
            "telefono": self.telefono,
            "tratamiento": self.tratamiento,
            "detalle": self.detalle,
            "fecha": self.fecha,
            "hora": self.hora,
            "vendedor": self.vendedor,
            "adelanto": self.adelanto,
            "duration_minutes": self.duration_minutes,
            "custom_fields": self.custom_fields,
            "comprobante_filename": self.comprobante_filename,
            "test_mode": self.test_mode,
            "status": "created",
            "n8n_status": None,
            "message": "Cita guardada en la app",
            "event_link": None,
            "calendar_sync_status": "skipped" if self.test_mode else "pending",
        }

    def n8n_form(self) -> dict:
        """El formulario que espera el workflow de citas de n8n (los nombres
        de campo son los del Form Trigger original)."""
        return {
            "Nombre completo": self.nombre_completo, "DNI": self.dni,
            "Telefono": self.telefono, "Tratamiento": self.tratamiento,
            "Detalle": self.detalle, "Fecha": self.fecha, "Hora": self.hora,
            "Vendedor": self.vendedor, "Adelanto": str(self.adelanto),
            "DuracionMinutos": str(self.duration_minutes),
            "CamposPersonalizados": json.dumps(self.custom_fields, ensure_ascii=False),
            "formMode": "test" if self.test_mode else "production",
        }


SKIPPED_CALENDAR = {"status": "skipped", "event_id": None, "event_link": None, "error": None}


@dataclass(frozen=True)
class SyncResult:
    """Lo que respondió el sincronizador externo (n8n). ``configured`` es
    False cuando el negocio no tiene webhook: la cita queda solo en la app."""

    configured: bool
    payload: dict = field(default_factory=lambda: {"success": True})
    error: str | None = None


@dataclass(frozen=True)
class AppointmentOutcome:
    status: str
    message: str
    event_link: str | None
    n8n_status: str | None
    payload: dict
    integration_errors: list[str]


def outcome(calendar: dict, sync: SyncResult, stored_event_link: str | None) -> AppointmentOutcome:
    errors: list[str] = []
    if calendar["status"] == "error":
        errors.append(calendar["error"])
    payload = dict(sync.payload)
    if not sync.configured:
        payload["message"] = "Cita guardada en el calendario de la app."
    if sync.error:
        errors.append(sync.error)
    status = "duplicate" if payload.get("citaDuplicada") else "created_with_errors" if errors else "created"
    message = (
        "Cita guardada; " + " ".join(errors)
        if errors else payload.get("message") or "Cita guardada correctamente"
    )
    return AppointmentOutcome(
        status=status,
        message=message,
        event_link=stored_event_link or payload.get("eventLink"),
        n8n_status=payload.get("status"),
        payload=payload,
        integration_errors=errors,
    )


def announcement(appointment: dict) -> tuple[str, str]:
    """Título y texto del aviso de una cita nueva."""
    return (
        f"Nueva cita: {appointment['nombre_completo']}",
        f"{appointment['tratamiento']} · {appointment['fecha']} {appointment['hora']}",
    )

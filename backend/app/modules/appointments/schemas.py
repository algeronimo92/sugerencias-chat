"""Contratos HTTP de appointments."""

from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, Field


class AppointmentAttachment(BaseModel):
    content_type: str = Field(min_length=1, max_length=100)
    data_base64: str = Field(min_length=1)
    filename: str = Field(min_length=1, max_length=255)


class AppointmentLeadUpdates(BaseModel):
    nombre: str | None = Field(default=None, min_length=1, max_length=200)
    servicio_interes: str | None = Field(default=None, min_length=1, max_length=120)
    custom_fields: dict[str, Any] = Field(default_factory=dict)


class AppointmentCreate(BaseModel):
    nombre_completo: str = Field(min_length=1, max_length=200)
    dni: str = Field(default="", max_length=20)
    telefono: str = Field(min_length=1, max_length=30)
    # Nombre neutral del servicio o motivo. Se conserva ``tratamiento`` en el
    # contrato para no romper clientes existentes, pero ya no sale de una
    # lista clínica fija.
    tratamiento: str = Field(min_length=1, max_length=120)
    detalle: str = Field(default="", max_length=500)
    fecha: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    hora: str = Field(min_length=1, max_length=10)
    vendedor: str = Field(min_length=1, max_length=50)
    adelanto: float = Field(default=0, ge=0)
    duration_minutes: int = Field(default=60, ge=5, le=1440)
    custom_fields: dict[str, Any] = Field(default_factory=dict)
    comprobante: AppointmentAttachment | None = None
    # Solo admins pueden activarlo (ver app/modules/appointments/api.py): manda
    # formMode="test" en vez de "production" en el payload a n8n, igual que
    # hacía el Form Trigger nativo al probarse desde su URL de test.
    test_mode: bool = False
    # Agendada desde la ficha del lead: se ata a él sin buscar por teléfono.
    lead_id: str | None = Field(
        default=None,
        pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
    )
    # Lo que el vendedor corrigió en la cita y pidió llevar también al lead.
    # Solo vale con ``lead_id``.
    lead_updates: AppointmentLeadUpdates | None = None


class AppointmentItem(BaseModel):
    id: int
    created_by_user_id: int
    created_by_name: str
    # None cuando el teléfono no identificó a un único lead — ver
    # service.resolve_lead_for_phone.
    lead_id: str | None = None
    lead_owner_name: str | None = None
    nombre_completo: str
    dni: str
    telefono: str
    tratamiento: str
    detalle: str
    fecha: str
    hora: str
    vendedor: str
    adelanto: float
    duration_minutes: int = 60
    custom_fields: dict[str, Any] = Field(default_factory=dict)
    comprobante_filename: str | None = None
    test_mode: bool
    status: Literal["created", "duplicate", "created_with_errors", "error"]
    n8n_status: str | None = None
    message: str | None = None
    event_link: str | None = None
    calendar_event_id: str | None = None
    calendar_sync_status: Literal["not_configured", "pending", "synced", "error", "skipped"] = "not_configured"
    calendar_sync_error: str | None = None
    created_at: str

class AppointmentCreated(BaseModel):
    """Resultado de registrar una cita. Lleva además lo que devolvió el
    workflow de n8n (por ejemplo ``citaDuplicada``), que viaja tal cual."""

    model_config = ConfigDict(extra="allow")

    success: bool
    message: str | None = None
    appointment: AppointmentItem
    eventLink: str | None = None
    calendarSyncStatus: str
    integrationErrors: list[str]


class CalendarEventField(BaseModel):
    key: str
    label: str
    custom: bool


class CalendarEventTemplate(BaseModel):
    """Plantilla del evento de Google Calendar. Los marcadores ``{campo}``
    nombran uno de ``fields``; el resto es texto libre."""

    title_template: str
    description_template: str
    default_title_template: str
    default_description_template: str
    fields: list[CalendarEventField]


class CalendarEventTemplateUpdate(BaseModel):
    # Los topes reales los aplica el dominio con un mensaje en español; estos
    # solo cortan un cuerpo absurdo antes de llegar ahí.
    title_template: str = Field(max_length=1000)
    description_template: str = Field(max_length=10000)

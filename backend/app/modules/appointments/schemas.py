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
    notices: list["AppointmentNoticeItem"] = Field(default_factory=list)


class AppointmentNoticeItem(BaseModel):
    """Un aviso de WhatsApp de la cita. ``status`` es lo que pasó al
    enviarlo (``sent``, ``failed``, ``skipped``, con ``reason`` si no salió);
    ``delivery_status`` lo que informó Meta después."""

    id: int
    audience: Literal["client", "staff"]
    recipient_name: str
    status: Literal["sent", "failed", "skipped"]
    reason: str | None = None
    delivery_status: Literal["sent", "delivered", "read", "failed"] | None = None
    delivered_at: str | None = None
    read_at: str | None = None
    created_at: str


AppointmentItem.model_rebuild()

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


class NoticeTemplate(BaseModel):
    id: int
    name: str
    content: str
    variable_count: int
    # Lo que se armó para cada variable en Plantillas, ya en la sintaxis del
    # aviso: el armador arranca con esto en vez de vacío.
    suggested_parameters: list[str] = []


class NoticeField(BaseModel):
    key: str
    label: str
    # cita | cita_personalizado | lead | lead_personalizado
    group: str


class NoticePreview(BaseModel):
    """La última cita real: el armador muestra cada variable con sus datos."""

    label: str
    values: dict[str, str]


class NoticeSettings(BaseModel):
    """Aviso de cita por WhatsApp (al cliente o al equipo). ``parameters`` es
    el contenido de cada variable, en orden: texto libre con marcadores
    ``{campo}`` que nombran uno de ``fields``."""

    enabled: bool
    template_id: int | None
    parameters: list[str]
    fields: list[NoticeField]
    templates: list[NoticeTemplate]
    preview: NoticePreview | None = None


class NoticeSenderNumber(BaseModel):
    id: str
    display_phone_number: str
    verified_name: str
    # El número del CRM no se puede elegir: sin número de avisos, los avisos
    # ya salen de ahí.
    is_crm: bool
    waba_id: str


class NoticeSenderAccount(BaseModel):
    """La cuenta de WhatsApp Business propia del número de avisos."""

    waba_id: str
    name: str


class NoticeSenderTemplate(BaseModel):
    """Una plantilla de los avisos y su copia en la cuenta del número de
    avisos. ``status``: el de Meta (``APPROVED``, ``PENDING``, ``REJECTED``…)
    o ``MISSING`` si todavía no se copió."""

    audience: Literal["client", "staff"]
    template_id: int
    name: str
    status: str


class NoticeSender(BaseModel):
    """Desde qué número salen los avisos de cita. ``phone_number_id`` vacío:
    del número del CRM. ``account`` vacío: el número está en la cuenta del
    CRM y usa sus plantillas."""

    phone_number_id: str | None
    numbers: list[NoticeSenderNumber]
    account: NoticeSenderAccount | None = None
    templates: list[NoticeSenderTemplate] = Field(default_factory=list)


class NoticeSenderUpdate(BaseModel):
    phone_number_id: str | None = Field(default=None, max_length=64)


class NoticeSenderSignup(BaseModel):
    """Lo que devuelve el Embedded Signup de Meta para el número de avisos."""

    code: str = Field(min_length=1, max_length=2048)
    waba_id: str = Field(min_length=1, max_length=64)
    # Ausente en coexistencia: Meta no lo manda y se resuelve en el backend.
    phone_number_id: str | None = Field(default=None, max_length=64)


class NoticeSettingsUpdate(BaseModel):
    enabled: bool
    template_id: int | None = None
    parameters: list[str] = Field(default_factory=list, max_length=20)

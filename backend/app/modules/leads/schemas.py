"""Contratos HTTP de leads."""

from datetime import date, datetime
from typing import Any, Annotated, Literal
from pydantic import BaseModel, Field, StringConstraints
from app.modules.leads.domain.types import INITIAL_LEAD_STAGE, LEAD_STAGE_KEY_PATTERN
from app.modules.catalogs.public import Tag
from app.modules.auth.ports.types import UserRole


# Clave de una etapa del embudo del negocio (lead_stages.key). Ya no es una
# lista cerrada: aquí solo se valida la forma; que exista y esté activa lo
# decide app/modules/leads/stages.py contra las etapas del tenant.
LeadStageKey = Annotated[str, StringConstraints(pattern=LEAD_STAGE_KEY_PATTERN)]
LeadStageKindValue = Literal["open", "won", "lost"]
StageColor = Annotated[str, StringConstraints(pattern=r"^#[0-9a-fA-F]{6}$", to_lower=True)]
StageName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]


class Chat(BaseModel):
    chat_id: str
    phone: str | None = None
    # Número informativo (llamadas, contacto alternativo), distinto del que
    # WhatsApp usa para enrutar mensajes. Texto libre, sin verificación contra
    # WhatsApp: puede ser un fijo, un celular de otra red, lo que sea.
    secondary_phone: str | None = None
    # Username público de WhatsApp/Meta. No todos los contactos tienen uno y
    # no es editable desde el CRM.
    username: str | None = None
    name: str | None = None
    servicio_interes: str | None = None
    vendedor_id: int | None = None
    vendedor: str | None = None
    origen: str | None = None
    notas: str | None = None
    stage: LeadStageKey = INITIAL_LEAD_STAGE
    con_especialista: bool = False
    automatizacion_pausada: bool = False
    conversacion_abierta: bool = False
    conversacion_abierta_at: str | None = None
    conversacion_cerrada_at: str | None = None
    conversacion_version: int = 0
    razon_perdido: str | None = None
    # Fechas ya serializadas a ISO por _row_to_chat: fecha_recontacto es un
    # DATE (YYYY-MM-DD), las otras dos timestamps con zona.
    fecha_recontacto: str | None = None
    proxima_cita: str | None = None
    # Contadores que lleva el sistema, no editables desde el CRM.
    contador_noshow: int | None = None
    toques_seguimiento: int | None = None
    fecha_ultimo_toque: str | None = None
    last_message: str | None = None
    last_message_sender: str | None = None
    # Tipo y subtipo literales de Meta: la lista usa el mismo contrato que la
    # burbuja para resumir el mensaje.
    last_message_type: str | None = None
    last_message_subtype: str | None = None
    # El último mensaje se eliminó: `last_message` viene vacío y la lista
    # muestra "Se eliminó este mensaje" en vez del texto original.
    last_message_deleted: bool = False
    timestamp: str | None = None
    last_customer_message_at: str | None = None
    unread_count: int = 0
    # Crudos para que el frontend decida el color del badge de no leídos:
    # "atendido por bot" si last_automated_reply_at es más nuevo que last_read_at.
    last_read_at: str | None = None
    last_automated_reply_at: str | None = None
    tags: list[Tag] = Field(default_factory=list)
    # Solo significativos con búsqueda activa. search_rank: 2 = match por
    # nombre/teléfono, 1 = por campos CRM, 0 = solo por un mensaje (en ese
    # caso matched_message trae el mensaje que contiene el término).
    search_rank: int = 2
    matched_message: str | None = None
    matched_message_id: int | None = None


class LeadActivityItem(BaseModel):
    id: int
    event_type: str
    actor_type: str
    actor_name: str | None = None
    old_value: dict | None = None
    new_value: dict | None = None
    metadata: dict | None = None
    created_at: str


class ChatPage(BaseModel):
    items: list[Chat]
    has_more: bool


class KanbanPage(BaseModel):
    items: list[Chat]
    has_more: bool


class KanbanSnapshot(BaseModel):
    # Una entrada por cada etapa del negocio (activas e inactivas), en orden.
    counts: dict[str, int]
    stages: dict[str, KanbanPage]


class LeadStageUpdate(BaseModel):
    stage: LeadStageKey
    # Solo se persiste al pasar a una etapa de tipo `lost` (como `perdido`);
    # se ignora en cualquier otra.
    razon_perdido: str | None = Field(default=None, max_length=500)


class LeadStageItem(BaseModel):
    """Etapa del embudo tal como la ve cualquier usuario del negocio."""

    key: str
    name: str
    color: str
    position: int
    kind: LeadStageKindValue
    is_active: bool
    description: str | None = None
    # La etapa inicial: no se puede borrar, desactivar ni volver no abierta.
    is_system: bool = False


class LeadStageAdminItem(LeadStageItem):
    lead_count: int = 0


class LeadStageCreate(BaseModel):
    name: StageName
    color: StageColor
    kind: LeadStageKindValue = "open"
    description: str | None = Field(default=None, max_length=500)


class LeadStagePatch(BaseModel):
    name: StageName | None = None
    color: StageColor | None = None
    kind: LeadStageKindValue | None = None
    is_active: bool | None = None
    description: str | None = Field(default=None, max_length=500)


class LeadStageOrder(BaseModel):
    keys: list[LeadStageKey] = Field(min_length=1, max_length=100)


class LeadMergeRequest(BaseModel):
    # El lead de la URL es el destino (se conserva); este es el origen, que se
    # borra tras mover todo su historial al destino.
    other_id: str


class LeadCreate(BaseModel):
    phone: str
    name: str
    servicio_interes: str | None = None
    vendedor_id: int | None = None
    origen: str | None = None
    notas: str | None = None
    secondary_phone: str | None = None
    custom_fields: dict[str, Any] = Field(default_factory=dict)


class LeadUpdate(BaseModel):
    phone: str | None = None
    secondary_phone: str | None = None
    name: str | None = None
    servicio_interes: str | None = None
    vendedor_id: int | None = None
    origen: str | None = None
    notas: str | None = None
    con_especialista: bool | None = None
    automatizacion_pausada: bool | None = None
    conversacion_abierta: bool | None = None
    razon_perdido: str | None = Field(default=None, max_length=500)
    fecha_recontacto: date | None = None
    proxima_cita: datetime | None = None


class SellerItem(BaseModel):
    id: int
    name: str
    role: UserRole

class UnreadCount(BaseModel):
    count: int


class PhoneConfig(BaseModel):
    default_country_code: str


# --- Dashboard -----------------------------------------------------------
# Un bloque por panel; lo arma leads/dashboard/queries.py.

class DashboardMetricItem(BaseModel):
    name: str
    value: int


class DashboardPoint(BaseModel):
    date: str
    value: int


class DashboardFunnelStep(DashboardMetricItem):
    # Porcentaje sobre los leads creados en el período, o None si no hubo.
    rate: float | None = None


class DashboardFlowRow(DashboardMetricItem):
    rule_id: int
    trigger_type: str
    completed: int
    failed: int
    skipped: int
    active: int
    last_at: str | None = None


class DashboardTagRow(DashboardMetricItem):
    id: int
    color: str


class DashboardUpcomingAppointment(BaseModel):
    id: int
    # None cuando el teléfono de la cita no identificó a un único lead.
    lead_id: str | None = None
    name: str
    date: str
    # Tal como se registró en el formulario: es texto, no un horario.
    time: str
    treatment: str | None = None


class DashboardSummary(BaseModel):
    total_leads: int
    new_leads: int
    awaiting_reply: int
    overdue_tasks: int
    completed_tasks: int
    avg_response_minutes: float | None = None
    appointments_created: int
    flows_started: int
    flows_active: int
    messages_sent: int
    tagged_leads: int


class DashboardPipeline(BaseModel):
    stale: list[DashboardMetricItem]
    conversations_open: int
    conversations_closed: int
    avg_close_hours: float | None = None


class DashboardFlowFailures(BaseModel):
    total: int
    failed: int
    rate: float | None = None
    top_errors: list[DashboardMetricItem]


class DashboardAutomations(BaseModel):
    by_flow: list[DashboardFlowRow]
    by_actor: list[DashboardMetricItem]
    by_source: list[DashboardMetricItem]
    by_trigger: list[DashboardMetricItem]
    trend: list[DashboardPoint]
    failures: DashboardFlowFailures
    active_now: dict[str, int]


class DashboardCoverage(BaseModel):
    total: int
    tagged: int
    untagged: int
    rate: float | None = None


class DashboardTags(BaseModel):
    coverage: DashboardCoverage
    top: list[DashboardTagRow]
    by_user: list[DashboardMetricItem]
    trend: list[DashboardPoint]


class DashboardNoShows(BaseModel):
    leads: int
    total: int


class DashboardLinkage(BaseModel):
    total: int
    linked: int
    unlinked: int
    rate: float | None = None


class DashboardAppointments(BaseModel):
    by_status: list[DashboardMetricItem]
    by_user: list[DashboardMetricItem]
    by_owner: list[DashboardMetricItem]
    by_treatment: list[DashboardMetricItem]
    trend: list[DashboardPoint]
    lost_reasons: list[DashboardMetricItem]
    upcoming: list[DashboardUpcomingAppointment]
    no_shows: DashboardNoShows
    linkage: DashboardLinkage


class DashboardMessages(BaseModel):
    trend: list[DashboardPoint]
    by_user: list[DashboardMetricItem]


class DashboardActivity(BaseModel):
    trend: list[DashboardPoint]
    by_type: list[DashboardMetricItem]
    by_user: list[DashboardMetricItem]
    messages: DashboardMessages


class DashboardMetrics(BaseModel):
    period_days: int
    scope: Literal["mine", "team"]
    summary: DashboardSummary
    stages: list[DashboardMetricItem]
    origins: list[DashboardMetricItem]
    services: list[DashboardMetricItem]
    sellers: list[DashboardMetricItem]
    new_leads_trend: list[DashboardPoint]
    funnel: list[DashboardFunnelStep]
    pipeline: DashboardPipeline
    automations: DashboardAutomations
    tags: DashboardTags
    appointments: DashboardAppointments
    activity: DashboardActivity
    generated_at: str

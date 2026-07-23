from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from domain_types import (
    AutomationBuilderMode,
    AutomationExecutionStatus,
    AutomationTrigger,
    NotificationType,
    TaskPriority,
    TaskStatus,
    TaskType,
)


LeadStage = Literal[
    "nuevo",
    "en_diagnostico",
    "calificado",
    "oferta_presentada",
    "en_objecion",
    "agendado",
    "cliente_activo",
    "postventa",
    "en_seguimiento",
    "en_nutricion",
    "perdido",
    "descalificado",
    "baja",
]


class Chat(BaseModel):
    chat_id: str
    phone: str | None = None
    name: str | None = None
    servicio_interes: str | None = None
    vendedor_id: int | None = None
    vendedor: str | None = None
    origen: str | None = None
    notas: str | None = None
    stage: LeadStage = "nuevo"
    con_especialista: bool = False
    last_message: str | None = None
    last_message_sender: str | None = None
    timestamp: str | None = None
    last_customer_message_at: str | None = None
    unread_count: int = 0
    tags: list["Tag"] = Field(default_factory=list)
    # Solo significativos con búsqueda activa. search_rank: 2 = match por
    # nombre/teléfono, 1 = por campos CRM, 0 = solo por un mensaje (en ese
    # caso matched_message trae el mensaje que contiene el término).
    search_rank: int = 2
    matched_message: str | None = None
    matched_message_id: int | None = None


class Tag(BaseModel):
    id: int
    name: str
    color: str


class TagCreate(BaseModel):
    name: str
    color: str = "#16a34a"


class TagUpdate(BaseModel):
    name: str | None = None
    color: str | None = None
    is_active: bool | None = None


class LeadActivityItem(BaseModel):
    id: int
    event_type: str
    actor_type: str
    actor_name: str | None = None
    old_value: dict | None = None
    new_value: dict | None = None
    metadata: dict | None = None
    created_at: str


class InternalNoteMentionItem(BaseModel):
    user_id: int
    user_name: str


class InternalNoteItem(BaseModel):
    id: int
    lead_id: str
    author_user_id: int
    author_name: str
    content: str
    created_at: str
    updated_at: str
    is_edited: bool = False
    mentions: list[InternalNoteMentionItem] = Field(default_factory=list)


class InternalNoteCreate(BaseModel):
    content: str
    mentioned_user_ids: list[int] = Field(default_factory=list)


class InternalNoteUpdate(BaseModel):
    content: str
    mentioned_user_ids: list[int] = Field(default_factory=list)


class NotificationItem(BaseModel):
    id: int
    notification_type: NotificationType
    title: str
    body: str
    lead_id: str | None = None
    source_id: str | None = None
    metadata: dict | None = None
    read_at: str | None = None
    created_at: str


class NotificationPage(BaseModel):
    items: list[NotificationItem]
    unread_count: int
    has_more: bool = False


class ChatPage(BaseModel):
    items: list[Chat]
    has_more: bool


class KanbanPage(BaseModel):
    items: list[Chat]
    has_more: bool


class KanbanSnapshot(BaseModel):
    counts: dict[LeadStage, int]
    stages: dict[LeadStage, KanbanPage]


class LeadStageUpdate(BaseModel):
    stage: LeadStage


class Message(BaseModel):
    id: int
    sender: str
    content: str | None = None
    sent_at: str | None = None
    media_url: str | None = None
    wa_message_id: str | None = None
    status: str | None = None
    # Dimensiones de la imagen adjunta: el frontend reserva el espacio exacto
    # antes de que cargue, para que la conversación no se mueva.
    media_width: int | None = None
    media_height: int | None = None


class MessagePage(BaseModel):
    items: list[Message]
    has_more: bool


class ScheduledMessageCreate(BaseModel):
    text: str = Field(min_length=1, max_length=4096)
    scheduled_at: datetime


class ScheduledMessageItem(BaseModel):
    id: int
    lead_id: str
    text: str
    scheduled_at: str
    status: Literal["scheduled", "processing", "queued", "sent", "failed", "cancelled"]
    created_by_user_id: int
    created_by_user_name: str
    queued_message_id: int | None = None
    error: str | None = None
    created_at: str


class CustomerServiceWindow(BaseModel):
    is_open: bool
    last_customer_message_at: str | None = None
    expires_at: str | None = None
    seconds_remaining: int = 0


class MessageStatusUpdate(BaseModel):
    wa_message_id: str
    status: str
    from_me: bool | None = None


class SendMessageRequest(BaseModel):
    text: str


class SendMediaRequest(BaseModel):
    content_type: str
    data_base64: str
    filename: str | None = None


class SendLocationRequest(BaseModel):
    latitude: float
    longitude: float


class TtsRequest(BaseModel):
    text: str


class TtsResponse(BaseModel):
    content_type: str
    data_base64: str


class LeadCreate(BaseModel):
    phone: str
    name: str
    servicio_interes: str | None = None
    vendedor_id: int | None = None
    origen: str | None = None
    notas: str | None = None


class LeadUpdate(BaseModel):
    phone: str | None = None
    name: str | None = None
    servicio_interes: str | None = None
    vendedor_id: int | None = None
    origen: str | None = None
    notas: str | None = None


class SellerItem(BaseModel):
    id: int
    name: str
    role: str


class SuggestionRequest(BaseModel):
    chat_id: str
    phone: str | None = None
    # Ignora la sugerencia cacheada y vuelve a pedirle una nueva a n8n — el
    # vendedor pide otras opciones porque las actuales no le sirven.
    force: bool = False


class Sugerencia(BaseModel):
    tactica: str
    canal: str
    texto: str | None = None
    adjuntos: list[str] = []
    motivo_adjuntos: str = ""
    porque: str


class SuggestionResponse(BaseModel):
    # `estado` es opcional: el workflow de n8n dejó de incluirlo en su salida
    # (ver senal_compra/alerta más abajo) y solo mandaba tipo_objecion en
    # versiones previas. Si algún día vuelve a mandarlo, debe coincidir con
    # el enum `lead_estado` — Pydantic rechaza cualquier etapa inventada
    # antes de que llegue a PostgreSQL.
    estado: LeadStage | None = None
    tipo_objecion: str | None = None
    senal_compra: bool = False
    alerta: str | None = None
    confianza: str
    analisis: str
    sugerencias: list[Sugerencia]


class SuggestionStatus(BaseModel):
    """Estado de la sugerencia guardada de un lead: lectura barata que nunca
    dispara la generación. `stale` indica que el cliente escribió después de
    generarse — la UI la muestra igual pero avisa que quedó desactualizada."""

    suggestion: SuggestionResponse | None = None
    generated_at: datetime | None = None
    stale: bool = False


class TaskCreate(BaseModel):
    lead_id: str
    title: str
    description: str | None = None
    task_type: TaskType = TaskType.FOLLOW_UP
    priority: TaskPriority = TaskPriority.NORMAL
    due_at: datetime
    remind_at: datetime | None = None
    assigned_user_id: int | None = None


class TaskUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    task_type: TaskType | None = None
    priority: TaskPriority | None = None
    due_at: datetime | None = None
    remind_at: datetime | None = None
    assigned_user_id: int | None = None
    status: TaskStatus | None = None


class TaskItem(BaseModel):
    id: int
    lead_id: str
    lead_name: str | None = None
    title: str
    description: str | None = None
    task_type: TaskType
    status: TaskStatus
    priority: TaskPriority
    due_at: str
    remind_at: str | None = None
    assigned_user_id: int
    assigned_user_name: str
    is_overdue: bool
    created_at: str


class TemplateCreate(BaseModel):
    name: str
    content: str
    shortcut: str | None = None
    category: str = "general"
    stage: LeadStage | None = None
    task_type: TaskType | None = None
    service: str | None = None
    template_type: Literal["internal", "official"] = "internal"
    official_name: str | None = None
    official_language: str | None = None
    official_category: Literal["MARKETING", "UTILITY", "AUTHENTICATION"] | None = None
    official_status: Literal["APPROVED", "PENDING", "REJECTED", "PAUSED", "DISABLED"] | None = None
    official_parameter_values: list[str] = Field(default_factory=list)
    interactive_type: Literal["none", "buttons", "list"] = "none"
    interactive_config: dict = Field(default_factory=dict)


class PersonalTemplateCreate(BaseModel):
    name: str
    content: str
    shortcut: str | None = None


class TemplateUpdate(BaseModel):
    name: str | None = None
    content: str | None = None
    shortcut: str | None = None
    category: str | None = None
    stage: LeadStage | None = None
    task_type: TaskType | None = None
    service: str | None = None
    is_active: bool | None = None
    official_name: str | None = None
    official_language: str | None = None
    official_category: Literal["MARKETING", "UTILITY", "AUTHENTICATION"] | None = None
    official_status: Literal["APPROVED", "PENDING", "REJECTED", "PAUSED", "DISABLED"] | None = None
    official_parameter_values: list[str] | None = None
    interactive_type: Literal["none", "buttons", "list"] | None = None
    interactive_config: dict | None = None


class TemplateItem(BaseModel):
    id: int
    name: str
    content: str
    shortcut: str | None = None
    category: str
    stage: LeadStage | None = None
    task_type: TaskType | None = None
    service: str | None = None
    is_active: bool
    visibility: Literal["global", "personal"] = "global"
    template_type: Literal["internal", "official"] = "internal"
    official_name: str | None = None
    official_language: str | None = None
    official_category: Literal["MARKETING", "UTILITY", "AUTHENTICATION"] | None = None
    official_status: Literal["APPROVED", "PENDING", "REJECTED", "PAUSED", "DISABLED"] | None = None
    official_parameter_values: list[str] = Field(default_factory=list)
    interactive_type: Literal["none", "buttons", "list"] = "none"
    interactive_config: dict = Field(default_factory=dict)
    is_favorite: bool = False
    last_used_at: str | None = None
    use_count: int = 0
    attachments: list["TemplateAttachmentItem"] = Field(default_factory=list)


class TemplateAttachmentItem(BaseModel):
    id: int
    media_url: str
    content_type: str
    filename: str
    position: int
    library_asset_id: int | None = None


class TemplateAttachmentCreate(BaseModel):
    content_type: str
    data_base64: str
    filename: str


class TemplateLibraryAttachmentCreate(BaseModel):
    asset_id: int


class MediaAssetCreate(BaseModel):
    content_type: str
    data_base64: str
    filename: str


class MediaAssetItem(BaseModel):
    id: int
    media_url: str
    content_type: str
    filename: str
    size_bytes: int
    uploaded_by_user_id: int | None = None
    uploaded_by_name: str | None = None
    created_at: str
    use_count: int = 0


class SendTemplateRequest(BaseModel):
    text: str | None = None
    parameters: list[str] = Field(default_factory=list)


class TemplateCapabilities(BaseModel):
    integration: str | None = None
    official_sending_supported: bool = False
    reason: str | None = None


class TemplateFavoriteUpdate(BaseModel):
    is_favorite: bool


class AutomationRuleCreate(BaseModel):
    name: str
    trigger_type: AutomationTrigger
    trigger_config: dict = Field(default_factory=dict)
    conditions: dict = Field(default_factory=dict)
    actions: list[dict] = Field(default_factory=list)
    delay_minutes: int = Field(default=0, ge=0, le=10080)
    max_executions_per_hour: int | None = Field(default=None, ge=1, le=1000)
    is_active: bool = True


class AutomationRuleUpdate(BaseModel):
    name: str | None = None
    trigger_type: AutomationTrigger | None = None
    trigger_config: dict | None = None
    conditions: dict | None = None
    actions: list[dict] | None = None
    delay_minutes: int | None = Field(default=None, ge=0, le=10080)
    max_executions_per_hour: int | None = Field(default=None, ge=1, le=1000)
    is_active: bool | None = None


class AutomationRuleItem(BaseModel):
    id: int
    name: str
    trigger_type: AutomationTrigger
    trigger_config: dict
    conditions: dict
    actions: list[dict]
    builder_mode: AutomationBuilderMode = AutomationBuilderMode.SIMPLE
    flow_definition: dict = Field(default_factory=dict)
    published_flow_definition: dict | None = None
    flow_version: int = 0
    delay_minutes: int
    max_executions_per_hour: int | None = None
    is_active: bool
    created_by_user_id: int
    created_by_name: str
    execution_count: int
    last_execution_at: str | None = None
    last_execution_status: str | None = None
    created_at: str
    updated_at: str


class AutomationExecutionItem(BaseModel):
    id: int
    rule_id: int
    rule_name: str
    lead_id: str | None = None
    lead_name: str | None = None
    trigger_type: AutomationTrigger
    status: AutomationExecutionStatus
    scheduled_for: str
    started_at: str | None = None
    finished_at: str | None = None
    action_results: list[dict]
    flow_state: dict = Field(default_factory=dict)
    error: str | None = None
    created_at: str


class AutomationFlowCreate(BaseModel):
    name: str
    flow_definition: dict


class AutomationFlowUpdate(BaseModel):
    name: str | None = None
    flow_definition: dict


class AutomationFlowSimulationRequest(BaseModel):
    lead_id: str


class AutomationFlowVersionItem(BaseModel):
    version: int
    created_at: str
    node_count: int
    edge_count: int
    is_current: bool

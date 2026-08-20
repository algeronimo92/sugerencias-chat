from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

from domain_types import (
    AutomationBuilderMode,
    AutomationExecutionStatus,
    AutomationTrigger,
    IssueReportPriority,
    IssueReportStatus,
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
    last_message_type: str | None = None
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
    is_active: bool = True
    created_by_user_id: int | None = None
    created_by_name: str | None = None
    created_at: str | None = None


class TagCreate(BaseModel):
    name: str
    color: str = "#16a34a"


class TagUpdate(BaseModel):
    name: str | None = None
    color: str | None = None
    is_active: bool | None = None


class LeadServiceItem(BaseModel):
    id: int
    name: str
    is_active: bool = True
    created_by_user_id: int | None = None
    created_by_name: str | None = None
    created_at: str | None = None


class LeadServiceCreate(BaseModel):
    name: str = Field(max_length=120)


class LeadServiceUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    is_active: bool | None = None


class TemplateCategoryItem(BaseModel):
    id: int
    name: str
    is_active: bool = True
    created_by_user_id: int | None = None
    created_by_name: str | None = None
    created_at: str | None = None


class TemplateCategoryCreate(BaseModel):
    name: str = Field(max_length=60)


class TemplateCategoryUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=60)
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
    # Solo se persiste al pasar a `perdido`; se ignora en cualquier otra etapa.
    razon_perdido: str | None = Field(default=None, max_length=500)


MessageType = Literal[
    "text",
    "image",
    "video",
    "ptv",
    "audio",
    "document",
    "location",
    "sticker",
    "contact",
    "poll",
    "reaction",
    "interactive",
    "template",
    "order",
    "product",
    "payment",
    "view_once",
    "unsupported",
]


class Message(BaseModel):
    id: int
    sender: str
    content: str | None = None
    sent_at: str | None = None
    media_url: str | None = None
    wa_message_id: str | None = None
    status: str | None = None
    # Tipo del mensaje. NULL sólo en filas legadas sin backfillear: el frontend
    # cae entonces al parseo de pseudo-tags de `content`.
    message_type: MessageType | None = None
    # Enriquecimiento IA del adjunto (descripción/transcripción/OCR). Se sirve
    # aparte para mostrarlo bajo demanda, no dentro de la burbuja.
    analysis: dict | None = None
    # Datos estructurados propios del tipo (lat/lon, filename, opciones…).
    payload: dict | None = None
    # Reacciones sobre este mensaje (badge estilo WhatsApp): lista de
    # {emoji, from_me}. None cuando nadie reaccionó.
    reactions: list[dict] | None = None
    # Última edición del texto. None = nunca se editó; con valor, la burbuja
    # muestra "Editado" como en WhatsApp.
    edited_at: str | None = None
    # Eliminado para todos. Con valor, el resto de los campos de contenido
    # vienen vacíos (el backend no los sirve) y el hilo pinta la lápida.
    deleted_at: str | None = None
    # Dimensiones de la imagen adjunta: el frontend reserva el espacio exacto
    # antes de que cargue, para que la conversación no se mueva.
    media_width: int | None = None
    media_height: int | None = None
    # Mensaje citado, ya resuelto a la fila local. Viene en None cuando el
    # mensaje no responde a nada, o cuando el citado no está en nuestra base
    # (histórico anterior a la integración, o enviado desde el teléfono).
    quoted_message_id: int | None = None
    quoted_sender: str | None = None
    quoted_content: str | None = None


class MessagePage(BaseModel):
    items: list[Message]
    has_more: bool


class HistoryMessage(BaseModel):
    """Mensaje leído de WhatsApp que no está registrado en la base.

    No tiene `id` local ni estado de entrega, y de los adjuntos solo se
    conserva el tipo y el epígrafe: el archivo nunca se descarga.
    """
    wa_message_id: str
    sender: Literal["cliente", "vendedor"]
    content: str | None = None
    sent_at: str
    message_type: MessageType | None = None
    payload: dict | None = None


class HistoryPage(BaseModel):
    items: list[HistoryMessage]
    has_more: bool
    # Cursor opaco de Evolution: el frontend lo devuelve tal cual.
    next_page: int | None = None


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
    # Id local del mensaje al que se responde (cita estilo WhatsApp).
    reply_to_message_id: int | None = Field(default=None, ge=1)


class SendMediaRequest(BaseModel):
    content_type: str
    data_base64: str
    filename: str | None = None
    # Epígrafe (el texto que va debajo de la imagen/video), como en WhatsApp.
    caption: str | None = None
    reply_to_message_id: int | None = Field(default=None, ge=1)


class SendLocationRequest(BaseModel):
    latitude: float
    longitude: float
    reply_to_message_id: int | None = Field(default=None, ge=1)


class EditMessageRequest(BaseModel):
    # Texto nuevo del mensaje. Mismo tope que un envío normal: es el mismo
    # mensaje de WhatsApp, solo que reescrito.
    text: str = Field(min_length=1, max_length=4096)


class ForwardMessagesRequest(BaseModel):
    # Mensajes del chat de origen a reenviar, y chats destino. Los topes son
    # los de WhatsApp: hasta 30 mensajes seleccionados y 5 chats por reenvío.
    message_ids: list[int] = Field(min_length=1, max_length=30)
    target_chat_ids: list[str] = Field(min_length=1, max_length=5)


class ForwardMessagesResponse(BaseModel):
    # Chats a los que efectivamente se encoló algo.
    forwarded_chats: int
    # Total de mensajes encolados (mensajes reenviables × chats destino).
    forwarded_messages: int
    # Mensajes que quedaron afuera por ser de un tipo que no se puede volver a
    # enviar (encuestas, contactos, stickers rotos…). El frontend lo avisa.
    skipped_messages: int


class ReactionRequest(BaseModel):
    # Emoji de la reacción. Vacío quita la reacción propia (como en WhatsApp).
    emoji: str = ""


class StickerRequest(BaseModel):
    # Id del asset de la librería de medios que se manda como sticker.
    asset_id: int = Field(ge=1)


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
    con_especialista: bool | None = None
    automatizacion_pausada: bool | None = None
    conversacion_abierta: bool | None = None
    razon_perdido: str | None = Field(default=None, max_length=500)
    fecha_recontacto: date | None = None
    proxima_cita: datetime | None = None


class SellerItem(BaseModel):
    id: int
    name: str
    role: str


# Tope de la indicación del asesor. Alineado con el maxLength del input del
# frontend (SuggestionInstructionBox): lo que se puede tipear es lo que viaja.
SUGGESTION_INSTRUCTION_MAX_LENGTH = 200


class SuggestionRequest(BaseModel):
    chat_id: str
    phone: str | None = None
    # Ignora la sugerencia cacheada y vuelve a pedirle una nueva a n8n — el
    # vendedor pide otras opciones porque las actuales no le sirven.
    force: bool = False
    # Indicación opcional del asesor para orientar la generación ("dar precio",
    # "no dar precio", "está interesado en Hollywood peel"). Se sanea acá para
    # que llegue limpia y acotada al prompt del workflow.
    instruction: str | None = None

    @field_validator("instruction")
    @classmethod
    def _clean_instruction(cls, value: str | None) -> str | None:
        if value is None:
            return None
        # Colapsa espacios y saltos de línea, descarta caracteres de control y
        # recorta al tope: el texto viaja como query param hasta el workflow.
        cleaned = " ".join(value.split())
        cleaned = "".join(ch for ch in cleaned if ch.isprintable())
        cleaned = cleaned[:SUGGESTION_INSTRUCTION_MAX_LENGTH].strip()
        return cleaned or None


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


class IssueReportAttachmentCreate(BaseModel):
    content_type: str = Field(min_length=1, max_length=100)
    data_base64: str = Field(min_length=1)
    filename: str = Field(min_length=1, max_length=255)


class IssueReportCreate(BaseModel):
    title: str = Field(min_length=3, max_length=120)
    description: str = Field(min_length=10, max_length=2000)
    current_path: str = Field(default="/", min_length=1, max_length=500)
    lead_id: UUID | None = None
    technical_context: dict = Field(default_factory=dict)
    attachments: list[IssueReportAttachmentCreate] = Field(default_factory=list, max_length=3)


class IssueReportUpdate(BaseModel):
    status: IssueReportStatus | None = None
    priority: IssueReportPriority | None = None

    @model_validator(mode="after")
    def require_change(self):
        if self.status is None and self.priority is None:
            raise ValueError("Debe indicar un estado o una prioridad")
        return self


class IssueReportCommentCreate(BaseModel):
    content: str = Field(min_length=1, max_length=2000)


class IssueReportAttachmentItem(BaseModel):
    id: int
    media_url: str
    filename: str
    content_type: str
    size_bytes: int


class IssueReportItem(BaseModel):
    id: int
    public_code: str
    reporter_user_id: int
    reporter_name: str
    title: str
    description: str
    status: IssueReportStatus
    priority: IssueReportPriority
    current_path: str
    lead_id: str | None = None
    technical_context: dict
    attachments: list[IssueReportAttachmentItem] = Field(default_factory=list)
    comment_count: int = 0
    resolved_at: str | None = None
    resolved_by_name: str | None = None
    created_at: str
    updated_at: str


class IssueReportCommentItem(BaseModel):
    id: int
    author_user_id: int
    author_name: str
    author_role: str
    content: str
    created_at: str


class IssueReportEventItem(BaseModel):
    id: int
    actor_name: str | None = None
    event_type: str
    previous_value: str | None = None
    new_value: str | None = None
    created_at: str


class IssueReportDetail(IssueReportItem):
    comments: list[IssueReportCommentItem] = Field(default_factory=list)
    events: list[IssueReportEventItem] = Field(default_factory=list)


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
    created_by_user_id: int | None = None
    created_by_name: str | None = None
    created_at: str | None = None
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


class MediaAssetUpdate(BaseModel):
    filename: str = Field(min_length=1, max_length=255)


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
    visible_to_sellers: bool = False


class AutomationRuleUpdate(BaseModel):
    name: str | None = None
    trigger_type: AutomationTrigger | None = None
    trigger_config: dict | None = None
    conditions: dict | None = None
    actions: list[dict] | None = None
    delay_minutes: int | None = Field(default=None, ge=0, le=10080)
    max_executions_per_hour: int | None = Field(default=None, ge=1, le=1000)
    is_active: bool | None = None
    visible_to_sellers: bool | None = None


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
    visible_to_sellers: bool = False
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
    rule_deleted: bool = False
    lead_id: str | None = None
    lead_name: str | None = None
    trigger_type: AutomationTrigger
    status: AutomationExecutionStatus
    scheduled_for: str
    paused_at: str | None = None
    # 'lead' si la congeló pausar el lead entero, 'execution' si el vendedor
    # pausó solo esta ejecución. None cuando no está congelada.
    pause_scope: str | None = None
    started_at: str | None = None
    finished_at: str | None = None
    action_results: list[dict]
    flow_state: dict = Field(default_factory=dict)
    error: str | None = None
    created_at: str
    start_source: str = "system"
    started_by_user_id: int | None = None
    started_by_name: str | None = None
    # Un admin autorizó a esta ejecución a enviar con la ventana de 24 h
    # cerrada. None cuando corre con la regla de siempre.
    window_override_at: str | None = None
    window_override_by_name: str | None = None


class AutomationExecutionRetryRequest(BaseModel):
    """Reintento de una ejecución con error. `ignore_service_window` es la
    autorización del admin para que los envíos salgan aunque la ventana de
    atención de 24 h esté cerrada; vale solo para esta ejecución."""

    ignore_service_window: bool = False


class AutomationFlowCreate(BaseModel):
    name: str
    flow_definition: dict


class AutomationFlowUpdate(BaseModel):
    name: str | None = None
    flow_definition: dict


class AutomationFlowSimulationRequest(BaseModel):
    lead_id: str


class ManualFlowStartRequest(BaseModel):
    chat_id: str


class AutomationFlowVersionItem(BaseModel):
    version: int
    created_at: str
    node_count: int
    edge_count: int
    is_current: bool

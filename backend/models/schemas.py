from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


LeadStage = Literal[
    "nuevo",
    "calificacion",
    "cotizacion",
    "objecion",
    "cierre",
    "agendado",
    "postventa",
    "sin_respuesta",
    "reactivacion",
    "perdido",
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
    last_message: str | None = None
    last_message_sender: str | None = None
    timestamp: str | None = None
    unread_count: int = 0
    tags: list["Tag"] = Field(default_factory=list)


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


class ChatPage(BaseModel):
    items: list[Chat]
    has_more: bool


class KanbanPage(BaseModel):
    items: list[Chat]
    has_more: bool


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


class MessagePage(BaseModel):
    items: list[Message]
    has_more: bool


class MessageStatusUpdate(BaseModel):
    wa_message_id: str
    status: str


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


class Sugerencia(BaseModel):
    tactica: str
    canal: str
    texto: str | None = None
    adjuntos: list[str] = []
    motivo_adjuntos: str = ""
    porque: str


class SuggestionResponse(BaseModel):
    # Debe coincidir con el enum `lead_estado` y con el Structured Output
    # Parser del agente n8n. Pydantic rechaza cualquier etapa inventada antes
    # de que llegue a PostgreSQL.
    estado: LeadStage
    tipo_objecion: str | None = None
    confianza: str
    analisis: str
    sugerencias: list[Sugerencia]


TaskType = Literal["whatsapp", "llamada", "cotizacion", "cita", "seguimiento", "otro"]
TaskStatus = Literal["pending", "completed", "canceled"]
TaskPriority = Literal["low", "normal", "high"]


class TaskCreate(BaseModel):
    lead_id: str
    title: str
    description: str | None = None
    task_type: TaskType = "seguimiento"
    priority: TaskPriority = "normal"
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


class TemplateFavoriteUpdate(BaseModel):
    is_favorite: bool

from datetime import date, datetime
from decimal import Decimal
from typing import Any, Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Field, StringConstraints, field_validator, model_validator

from domain_types import (
    INITIAL_LEAD_STAGE,
    LEAD_STAGE_KEY_PATTERN,
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


# Clave de una etapa del embudo del negocio (lead_stages.key). Ya no es una
# lista cerrada: aquí solo se valida la forma; que exista y esté activa lo
# decide services/lead_stages.py contra las etapas del tenant.
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
    description: str | None = None
    price: Decimal | None = None
    price_notes: str | None = None
    created_by_user_id: int | None = None
    created_by_name: str | None = None
    created_at: str | None = None


class LeadServiceCreate(BaseModel):
    name: str = Field(max_length=120)


class LeadServiceUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    is_active: bool | None = None
    # Catálogo que consulta el asistente IA. La moneda es la del perfil del
    # negocio; ``price_notes`` cubre packs, promociones o rangos.
    description: str | None = Field(default=None, max_length=1000)
    price: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    price_notes: str | None = Field(default=None, max_length=500)


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


class Message(BaseModel):
    """Un mensaje del hilo con el contrato de Meta.

    ``message_type``/``message_subtype`` son los literales de Meta y
    ``provider_payload`` el objeto que Meta mandó o el cuerpo exacto que se le
    envió: el frontend renderiza desde ahí. Un tipo que el contrato no conoce
    llega igual, con su nombre, para que la UI muestre lo disponible.
    ``content``, ``media_url`` y ``payload`` son proyecciones del CRM.
    """

    id: int
    sender: str
    direction: str | None = None
    content: str | None = None
    sent_at: str | None = None
    media_url: str | None = None
    wa_message_id: str | None = None
    # Estado interno del envío (outbox) y el que informa Meta, por separado.
    outbox_status: str | None = None
    meta_status: str | None = None
    # Último evento de estado completo de Meta (errores, pricing, conversation).
    status_payload: dict | None = None
    message_type: str | None = None
    message_subtype: str | None = None
    provider_payload: dict | None = None
    # Enriquecimiento IA del adjunto (descripción/transcripción/OCR). Se sirve
    # aparte para mostrarlo bajo demanda, no dentro de la burbuja.
    analysis: dict | None = None
    # Proyección del CRM: lo que el cuerpo de Meta no trae (datos de plantilla,
    # reenviado, álbum, imagen de anuncio rehospedada).
    payload: dict | None = None
    # Reacciones sobre este mensaje (badge estilo WhatsApp), derivadas de los
    # eventos de reacción: lista de {emoji, from_me}. None si nadie reaccionó.
    reactions: list[dict] | None = None
    edited_at: str | None = None
    # Eliminado para todos (histórico). Con valor, el resto de los campos de
    # contenido vienen vacíos y el hilo pinta la lápida.
    deleted_at: str | None = None
    # Dimensiones de la imagen adjunta: el frontend reserva el espacio exacto
    # antes de que cargue, para que la conversación no se mueva.
    media_width: int | None = None
    media_height: int | None = None
    # Mensaje citado, ya resuelto a la fila local. Viene en None cuando el
    # mensaje no responde a nada o el citado no está en nuestra base.
    quoted_message_id: int | None = None
    quoted_sender: str | None = None
    quoted_content: str | None = None
    quoted_message_type: str | None = None
    # Fijado nativo del CRM: no existe forma de replicarlo hacia WhatsApp.
    pinned_at: str | None = None
    # Motivo real de un envío que el outbox dio por fallido (su last_error).
    error_detail: str | None = None


class MessagePage(BaseModel):
    items: list[Message]
    has_more: bool


class PinnedMessagesResponse(BaseModel):
    items: list[Message]


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
    # Id opaco (lo genera el frontend) que comparten varias fotos/videos
    # elegidos juntos en el mismo picker: agrupa el hilo del CRM en grilla sin
    # depender del heurístico de tiempo, ver mediaGroups.ts. Solo se guarda,
    # no lo interpreta el backend — WhatsApp no tiene noción de álbum saliente.
    album_id: str | None = Field(default=None, max_length=64)


class SendLocationRequest(BaseModel):
    latitude: float
    longitude: float
    reply_to_message_id: int | None = Field(default=None, ge=1)


class ContactShareItem(BaseModel):
    full_name: str = Field(min_length=1, max_length=256)
    phone_number: str = Field(min_length=8, max_length=32)


class SendContactsRequest(BaseModel):
    contacts: list[ContactShareItem] = Field(min_length=1, max_length=20)
    reply_to_message_id: int | None = Field(default=None, ge=1)


class SendInteractiveRequest(BaseModel):
    # Objeto ``interactive`` de Meta tal cual (con ``type``: button, list,
    # product, product_list, catalog_message, flow o call_permission_request).
    interactive: dict
    reply_to_message_id: int | None = Field(default=None, ge=1)


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
    secondary_phone: str | None = None


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


class AnalysisRequest(BaseModel):
    chat_id: str


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
    # versiones previas. Si algún día vuelve a mandarlo, se ignora: el
    # copiloto no mueve etapas (ver routers/suggestions.py).
    estado: str | None = None
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


class AppointmentAttachment(BaseModel):
    content_type: str = Field(min_length=1, max_length=100)
    data_base64: str = Field(min_length=1)
    filename: str = Field(min_length=1, max_length=255)


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
    # Solo admins pueden activarlo (ver routers/appointments.py): manda
    # formMode="test" en vez de "production" en el payload a n8n, igual que
    # hacía el Form Trigger nativo al probarse desde su URL de test.
    test_mode: bool = False


class AppointmentItem(BaseModel):
    id: int
    created_by_user_id: int
    created_by_name: str
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


CustomFieldEntity = Literal["lead", "appointment"]
CustomFieldType = Literal["text", "textarea", "number", "date", "datetime", "boolean", "select"]


class CustomFieldDefinitionCreate(BaseModel):
    entity_type: CustomFieldEntity
    label: str = Field(min_length=1, max_length=80)
    key: str | None = Field(default=None, pattern=r"^[a-z][a-z0-9_]{0,39}$")
    field_type: CustomFieldType = "text"
    required: bool = False
    options: list[str] = Field(default_factory=list, max_length=50)
    position: int = Field(default=0, ge=0, le=10000)


class CustomFieldDefinitionUpdate(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=80)
    required: bool | None = None
    options: list[str] | None = Field(default=None, max_length=50)
    position: int | None = Field(default=None, ge=0, le=10000)
    is_active: bool | None = None


class CustomFieldDefinitionItem(BaseModel):
    id: int
    entity_type: CustomFieldEntity
    key: str
    label: str
    field_type: CustomFieldType
    required: bool
    options: list[str]
    position: int
    is_active: bool


class CustomFieldValues(BaseModel):
    values: dict[str, Any] = Field(default_factory=dict)


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
    category: str = "General"
    stage: LeadStageKey | None = None
    task_type: TaskType | None = None
    service: str | None = None
    template_type: Literal["internal", "official"] = "internal"
    official_name: str | None = None
    official_language: str | None = None
    official_category: Literal["MARKETING", "UTILITY", "AUTHENTICATION"] | None = None
    official_status: str | None = None
    official_parameter_values: list[str] = Field(default_factory=list)
    official_header_type: Literal["none", "text", "image"] = "none"
    official_header_text: str | None = None
    official_header_media_asset_id: int | None = None
    official_footer: str | None = None
    official_buttons: list[dict] = Field(default_factory=list)
    interactive_type: Literal["none", "button", "list"] = "none"
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
    stage: LeadStageKey | None = None
    task_type: TaskType | None = None
    service: str | None = None
    is_active: bool | None = None
    official_name: str | None = None
    official_language: str | None = None
    official_category: Literal["MARKETING", "UTILITY", "AUTHENTICATION"] | None = None
    official_status: str | None = None
    official_parameter_values: list[str] | None = None
    official_header_type: Literal["none", "text", "image"] | None = None
    official_header_text: str | None = None
    official_header_media_asset_id: int | None = None
    official_footer: str | None = None
    official_buttons: list[dict] | None = None
    interactive_type: Literal["none", "button", "list"] | None = None
    interactive_config: dict | None = None


class TemplateItem(BaseModel):
    id: int
    name: str
    content: str
    shortcut: str | None = None
    category: str
    stage: LeadStageKey | None = None
    task_type: TaskType | None = None
    service: str | None = None
    is_active: bool
    visibility: Literal["global", "personal"] = "global"
    template_type: Literal["internal", "official"] = "internal"
    official_name: str | None = None
    official_language: str | None = None
    official_category: Literal["MARKETING", "UTILITY", "AUTHENTICATION"] | None = None
    official_status: str | None = None
    official_rejected_reason: str | None = None
    official_parameter_values: list[str] = Field(default_factory=list)
    meta_template_id: str | None = None
    official_header_type: Literal["none", "text", "image"] = "none"
    official_header_text: str | None = None
    official_header_media_asset_id: int | None = None
    official_header_media_url: str | None = None
    official_header_media_content_type: str | None = None
    official_header_media_filename: str | None = None
    official_footer: str | None = None
    official_buttons: list[dict] = Field(default_factory=list)
    interactive_type: Literal["none", "button", "list"] = "none"
    interactive_config: dict = Field(default_factory=dict)
    imported_from_meta: bool = False
    is_favorite: bool = False
    last_used_at: str | None = None
    use_count: int = 0
    created_by_user_id: int | None = None
    created_by_name: str | None = None
    created_at: str | None = None
    attachments: list["TemplateAttachmentItem"] = Field(default_factory=list)


class TemplateMetaImport(BaseModel):
    name: str
    category: str
    shortcut: str | None = None
    official_parameter_values: list[str] = Field(default_factory=list)


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
    ai_description: str | None = None


class SendTemplateRequest(BaseModel):
    text: str | None = None
    parameters: list[str] = Field(default_factory=list)


class InteractiveLimits(BaseModel):
    text: int
    body: int
    title: int
    footer: int
    button_text: int
    button_id: int
    max_buttons: int
    list_button_text: int
    section_title: int
    row_title: int
    row_description: int
    row_id: int
    max_sections: int
    max_rows: int


class TemplateCapabilities(BaseModel):
    integration: str | None = None
    official_sending_supported: bool = False
    reason: str | None = None
    interactive_limits: InteractiveLimits
    interactive_default_footer: str = ""
    # Salidas que dependen de la cuenta (contracts/meta_messages.json).
    catalog_enabled: bool = False
    flows_enabled: bool = False
    call_permission_enabled: bool = False
    # Con qué completar esas salidas: el catálogo de la cuenta y los Flows
    # publicados (id o nombre, tal como se configuraron).
    catalog_id: str | None = None
    published_flows: list[str] = Field(default_factory=list)


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


class PushSubscriptionKeys(BaseModel):
    p256dh: str
    auth: str


class PushSubscribeRequest(BaseModel):
    endpoint: str
    keys: PushSubscriptionKeys


class PushUnsubscribeRequest(BaseModel):
    endpoint: str


class VapidPublicKeyResponse(BaseModel):
    public_key: str

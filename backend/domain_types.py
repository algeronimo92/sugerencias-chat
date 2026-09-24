from enum import StrEnum


class AutomationTrigger(StrEnum):
    LEAD_CREATED = "lead_created"
    CONVERSATION_STARTED = "conversation_started"
    STAGE_CHANGED = "stage_changed"
    MESSAGE_RECEIVED = "message_received"
    SELLER_RESPONSE_OVERDUE = "seller_response_overdue"
    CUSTOMER_RESPONSE_OVERDUE = "customer_response_overdue"
    TASK_DUE = "task_due"
    MANUAL = "manual"


class AutomationActionType(StrEnum):
    CREATE_TASK = "create_task"
    ASSIGN_SELLER = "assign_seller"
    ADD_TAG = "add_tag"
    REMOVE_TAG = "remove_tag"
    CHANGE_STAGE = "change_stage"
    NOTIFY = "notify"
    SEND_TEMPLATE = "send_template"
    SEND_MESSAGE = "send_message"
    CHANGE_SERVICE = "change_service"
    SET_CONVERSATION_STATE = "set_conversation_state"
    SEND_AUDIO = "send_audio"
    SEND_ATTACHMENT = "send_attachment"
    SEND_MEDIA = "send_media"
    REACT_TO_LAST_CUSTOMER_MESSAGE = "react_to_last_customer_message"


class FlowNodeType(StrEnum):
    TRIGGER = "trigger"
    CONDITION = "condition"
    ACTION = "action"
    INVOKE_FLOW = "invoke_flow"
    WAIT = "wait"
    WAIT_ANY = "wait_any"
    QUESTION = "question"
    ROUND_ROBIN = "round_robin"
    END = "end"


class WaitAnyConditionKind(StrEnum):
    TIMER = "timer"
    MESSAGE = "message"
    BUSINESS_HOURS = "business_hours"
    # Lo que el cliente ve reproducido de lo que le mandamos nosotros.
    MEDIA_PLAYED = "media_played"
    # Lo contrario: el cliente nos mandó a nosotros una foto o un archivo.
    # Va aparte de MESSAGE porque un "ahorita te la mando" no es la foto, y
    # el flujo que la pidió necesita distinguirlos.
    MEDIA_RECEIVED = "media_received"


class QuestionHandle(StrEnum):
    OTHER = "other"
    TIMEOUT = "timeout"
    # Respondió con una foto o un archivo en vez de tocar un botón. Es la
    # única salida opcional del nodo: si el flujo no la conecta, esa respuesta
    # sigue cayendo en OTHER como antes de que existiera.
    MEDIA = "media"


class FlowConditionType(StrEnum):
    STAGE_EQUALS = "stage_equals"
    ORIGIN_CONTAINS = "origin_contains"
    SERVICE_CONTAINS = "service_contains"
    MESSAGE_CONTAINS = "message_contains"
    MESSAGE_EQUALS = "message_equals"
    MESSAGE_NOT_CONTAINS = "message_not_contains"
    # Sobre la descripción que la IA genera para los adjuntos
    # (wsp_messages.analysis->>'summary'), no sobre el texto del cliente: es
    # lo que permite separar una foto de rostro de un comprobante de pago.
    MEDIA_ANALYSIS_CONTAINS = "media_analysis_contains"
    # Sobre la estructura de Meta del mensaje, no sobre su texto: el id que
    # eligió el cliente (button_reply.id, list_reply.id o el payload del
    # botón de una plantilla) y el tipo literal (``order``,
    # ``interactive/nfm_reply``...).
    REPLY_ID_EQUALS = "reply_id_equals"
    MESSAGE_TYPE_EQUALS = "message_type_equals"
    SELLER_EQUALS = "seller_equals"
    TAG_PRESENT = "tag_present"
    WHATSAPP_WINDOW_OPEN = "whatsapp_window_open"
    BUSINESS_HOURS = "business_hours"


class FlowHandle(StrEnum):
    NEXT = "next"
    YES = "yes"
    NO = "no"


class AutomationBuilderMode(StrEnum):
    SIMPLE = "simple"
    VISUAL = "visual"


class AutomationExecutionStatus(StrEnum):
    SCHEDULED = "scheduled"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    SKIPPED = "skipped"
    # No terminal: la ejecución quedó congelada porque el vendedor pausó la
    # automatización del lead. Conserva scheduled_for y paused_at para que al
    # reanudar se recupere el tiempo que le faltaba (ver pause_lead_executions
    # / resume_lead_executions en automation_service).
    PAUSED = "paused"


class NotificationType(StrEnum):
    INTERNAL_NOTE_MENTION = "internal_note_mention"
    AUTOMATION = "automation"
    ISSUE_REPORT = "issue_report"
    APPOINTMENT = "appointment"
    # Fallo puntual por ventana de 24 h cerrada — antes viajaba como AUTOMATION
    # genérico con metadata.error_code, ahora es su propio evento para poder
    # distinguirlo (ícono, filtros, etc.) sin depender de leer la metadata.
    SERVICE_WINDOW_CLOSED = "service_window_closed"


class IssueReportStatus(StrEnum):
    NEW = "new"
    IN_REVIEW = "in_review"
    NEEDS_INFO = "needs_info"
    RESOLVED = "resolved"


class IssueReportPriority(StrEnum):
    LOW = "low"
    NORMAL = "normal"
    HIGH = "high"
    CRITICAL = "critical"


class AutomationRecipient(StrEnum):
    SELLER = "seller"
    SPECIFIC = "specific"


class TaskType(StrEnum):
    WHATSAPP = "whatsapp"
    CALL = "llamada"
    QUOTE = "cotizacion"
    APPOINTMENT = "cita"
    FOLLOW_UP = "seguimiento"
    OTHER = "otro"


class TaskStatus(StrEnum):
    PENDING = "pending"
    COMPLETED = "completed"
    CANCELED = "canceled"


class TaskPriority(StrEnum):
    LOW = "low"
    NORMAL = "normal"
    HIGH = "high"


class MessageSender(StrEnum):
    """Quién envió el mensaje en wsp_messages.sender."""

    CUSTOMER = "cliente"
    SELLER = "vendedor"


class MessageOutboxStatus(StrEnum):
    """Estado interno de un envío en ``wsp_messages.outbox_status``.

    Describe nuestra cola, no WhatsApp: lo que pasó del lado de Meta vive en
    ``meta_status`` con el valor literal que informa Meta.
    """

    QUEUED = "queued"
    SENDING = "sending"
    SENT = "sent"
    # Falló un intento y queda otro programado.
    RETRYABLE_FAILED = "retryable_failed"
    # Agotó los intentos o el error no admite reintento automático.
    FAILED = "failed"
    # Un fallo que alguien revisó y decidió no reenviar.
    DISCARDED = "discarded"


class TemplateType(StrEnum):
    INTERNAL = "internal"
    OFFICIAL = "official"


class InteractiveType(StrEnum):
    """Subtipo interactivo de una plantilla del CRM: el literal de Meta."""

    NONE = "none"
    BUTTON = "button"
    LIST = "list"


class LeadStageKind(StrEnum):
    """Semántica de una etapa del embudo, independiente de su nombre.

    Las etapas son filas por negocio (``lead_stages``): el código nunca
    decide por la clave ni por el nombre visible, sino por esto. Una etapa
    ``LOST`` pide y guarda la razón de pérdida al entrar y la limpia al
    salir hacia una etapa que no lo es.
    """

    OPEN = "open"
    WON = "won"
    LOST = "lost"


# Etapa en la que nace todo lead. Es la única clave que el código fija: la
# base impide desactivarla (lead_stages_initial_active_check) y la API
# impide borrarla. El resto de las claves las define cada negocio.
INITIAL_LEAD_STAGE = "nuevo"

# Clave estable de una etapa: la guardan leads.estado, las automatizaciones,
# las plantillas y el historial, así que no cambia al renombrar la etapa.
LEAD_STAGE_KEY_PATTERN = r"^[a-z][a-z0-9_]{0,39}$"


class OutboxStatus(StrEnum):
    PENDING = "pending"
    PROCESSING = "processing"
    SENT = "sent"
    FAILED = "failed"
    DISCARDED = "discarded"


class ScheduledMessageStatus(StrEnum):
    SCHEDULED = "scheduled"
    PROCESSING = "processing"
    QUEUED = "queued"
    SENT = "sent"
    FAILED = "failed"
    CANCELLED = "cancelled"

"""Tipos del motor de automatizaciones: disparadores, acciones, bloques y estados."""

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


class AutomationRecipient(StrEnum):
    SELLER = "seller"
    SPECIFIC = "specific"

from enum import StrEnum


class AutomationTrigger(StrEnum):
    LEAD_CREATED = "lead_created"
    STAGE_CHANGED = "stage_changed"
    MESSAGE_RECEIVED = "message_received"
    SELLER_RESPONSE_OVERDUE = "seller_response_overdue"
    CUSTOMER_RESPONSE_OVERDUE = "customer_response_overdue"
    TASK_DUE = "task_due"


class AutomationActionType(StrEnum):
    CREATE_TASK = "create_task"
    ASSIGN_SELLER = "assign_seller"
    ADD_TAG = "add_tag"
    REMOVE_TAG = "remove_tag"
    CHANGE_STAGE = "change_stage"
    NOTIFY = "notify"
    SEND_TEMPLATE = "send_template"


class FlowNodeType(StrEnum):
    TRIGGER = "trigger"
    CONDITION = "condition"
    ACTION = "action"
    WAIT = "wait"
    END = "end"


class FlowConditionType(StrEnum):
    STAGE_EQUALS = "stage_equals"
    ORIGIN_CONTAINS = "origin_contains"
    SERVICE_CONTAINS = "service_contains"
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


class NotificationType(StrEnum):
    INTERNAL_NOTE_MENTION = "internal_note_mention"
    AUTOMATION = "automation"


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

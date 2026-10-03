"""Tipos, estados y prioridades de las tareas."""

from enum import StrEnum


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

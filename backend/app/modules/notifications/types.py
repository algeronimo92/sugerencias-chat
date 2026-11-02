"""Tipos de las notificaciones."""

from enum import StrEnum


class NotificationType(StrEnum):
    INTERNAL_NOTE_MENTION = "internal_note_mention"
    AUTOMATION = "automation"
    ISSUE_REPORT = "issue_report"
    APPOINTMENT = "appointment"
    # Fallo puntual por ventana de 24 h cerrada — antes viajaba como AUTOMATION
    # genérico con metadata.error_code, ahora es su propio evento para poder
    # distinguirlo (ícono, filtros, etc.) sin depender de leer la metadata.
    SERVICE_WINDOW_CLOSED = "service_window_closed"

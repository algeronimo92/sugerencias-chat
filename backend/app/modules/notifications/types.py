"""Tipos de las notificaciones."""

from enum import StrEnum


class NotificationType(StrEnum):
    INTERNAL_NOTE_MENTION = "internal_note_mention"
    AUTOMATION = "automation"
    ISSUE_REPORT = "issue_report"
    APPOINTMENT = "appointment"
    # La cita se editó a mano en Google Calendar y el cambio espera que
    # alguien lo confirme en el CRM (sus recordatorios quedan retenidos).
    APPOINTMENT_CHANGE = "appointment_change"
    # Fallo puntual por ventana de 24 h cerrada — antes viajaba como AUTOMATION
    # genérico con metadata.error_code, ahora es su propio evento para poder
    # distinguirlo (ícono, filtros, etc.) sin depender de leer la metadata.
    SERVICE_WINDOW_CLOSED = "service_window_closed"
    # Un cliente llamó por WhatsApp y nadie atendió.
    MISSED_CALL = "missed_call"
    # Meta pausó las llamadas del número (suele ser por reportes de clientes).
    CALLS_PAUSED = "calls_paused"

"""Errores de dominio de las citas."""

from app.core.errors import Conflict, DomainError, NotFound


class AppointmentNotFound(NotFound):
    """Cita no encontrada"""

    code = "appointment_not_found"


class TestAppointmentNotSynced(Conflict):
    """Las citas de prueba no se sincronizan con Google Calendar"""

    code = "test_appointment_not_synced"


class CalendarNotConfigured(Conflict):
    """Activa Google Calendar y guarda su configuración antes de sincronizar"""

    code = "calendar_not_configured"


class CalendarSyncFailed(DomainError):
    """Google Calendar no aceptó el evento."""

    status_code = 502
    code = "calendar_sync_failed"

"""Errores de dominio de las citas."""

from app.core.errors import Conflict, DomainError, NotFound


class AppointmentNotFound(NotFound):
    """Cita no encontrada"""

    code = "appointment_not_found"


class TestAppointmentNotSynced(Conflict):
    """Las citas de prueba no se sincronizan con Google Calendar"""

    code = "test_appointment_not_synced"


class DismissedAppointmentNotSynced(Conflict):
    """La cita está desestimada: restáurala antes de mandarla al calendario"""

    code = "dismissed_appointment_not_synced"


class CalendarNotConfigured(Conflict):
    """Activa Google Calendar y guarda su configuración antes de sincronizar"""

    code = "calendar_not_configured"


class CalendarSyncFailed(DomainError):
    """Google Calendar no aceptó el evento."""

    status_code = 502
    code = "calendar_sync_failed"


class AppointmentLeadNotFound(NotFound):
    """El lead de la cita ya no existe"""

    code = "appointment_lead_not_found"


class NoticeNotSent(DomainError):
    """No se pudo mandar el aviso de cita."""

    status_code = 502
    code = "appointment_notice_not_sent"


class NoticeSenderNotLinked(DomainError):
    """Meta no dejó vinculado el número de avisos (o no en la WABA del CRM).

    409 y no 502: detrás de Cloudflare un 502 del origen se reemplaza por la
    página de error de Cloudflare y el admin nunca ve por qué falló (pasó al
    probar la vinculación en coexistencia)."""

    status_code = 409
    code = "appointment_notice_sender_not_linked"


class NoticeAccountUnavailable(DomainError):
    """Meta no respondió por los números o las plantillas de una cuenta de
    WhatsApp Business del negocio (o rechazó la copia de una plantilla).
    409 por lo mismo que ``NoticeSenderNotLinked``: un 502 lo tapa
    Cloudflare."""

    status_code = 409
    code = "appointment_notice_account_unavailable"

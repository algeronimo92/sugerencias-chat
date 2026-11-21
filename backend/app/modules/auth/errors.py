"""Errores de las cuentas de usuario."""


class EmailAlreadyExistsError(Exception):
    pass


class LastAdminError(Exception):
    """Se levanta al intentar desactivar/degradar al único admin activo."""


class AnalystCannotHandleCallsError(Exception):
    """El rol no tiene ``calls.handle`` (por defecto, el analista): sin ese
    permiso una llamada nunca podría sonarle. El nombre quedó de cuando solo
    el analista no atendía."""


class LastCallAgentError(Exception):
    """Con las llamadas activas no puede quedar nadie para atenderlas:
    sonarían en el vacío y WhatsApp oculta el botón de llamar."""


class UserAlreadyActiveError(Exception):
    """La cuenta ya fue activada alguna vez: no hay invitación pendiente que
    reenviar, copiar ni cuyo correo corregir."""

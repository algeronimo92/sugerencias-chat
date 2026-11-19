"""Errores de las cuentas de usuario."""


class EmailAlreadyExistsError(Exception):
    pass


class LastAdminError(Exception):
    """Se levanta al intentar desactivar/degradar al único admin activo."""


class AnalystCannotHandleCallsError(Exception):
    """El analista solo mira el dashboard: no abre chats ni tiene tiempo real,
    así que una llamada nunca podría sonarle."""


class LastCallAgentError(Exception):
    """Con las llamadas activas no puede quedar nadie para atenderlas:
    sonarían en el vacío y WhatsApp oculta el botón de llamar."""


class UserAlreadyActiveError(Exception):
    """La cuenta ya fue activada alguna vez: no hay invitación pendiente que
    reenviar, copiar ni cuyo correo corregir."""

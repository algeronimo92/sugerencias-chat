"""Errores de las cuentas de usuario."""


class EmailAlreadyExistsError(Exception):
    pass


class LastAdminError(Exception):
    """Se levanta al intentar desactivar/degradar al único admin activo."""

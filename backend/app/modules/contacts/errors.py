"""Errores de negocio de la agenda."""

from app.core.errors import Conflict, Invalid, NotFound


class ContactNotFound(NotFound):
    """Contacto no encontrado."""


class ContactAlreadyExists(Conflict):
    """Ya hay un contacto con ese número."""

    code = "contact_exists"


class InvalidContact(Invalid):
    """Revisa los datos del contacto."""


class ContactWithoutPhone(Invalid):
    """El contacto no tiene número: WhatsApp no deja abrirle un chat."""

    code = "contact_without_phone"


class ImportNotFound(NotFound):
    """Importación no encontrada."""


class ImportClosed(Conflict):
    """Esta importación ya terminó."""

    code = "import_closed"


class InvalidImport(Invalid):
    """No se pudo leer la importación."""

"""Valores fijos de la agenda y sus importaciones."""

from enum import StrEnum


class ContactOrigin(StrEnum):
    MANUAL = "manual"
    CSV = "csv"
    WHATSAPP_APP = "whatsapp_app"
    # Escribió primero: el contacto nació de su lead.
    LEAD = "lead"


class ImportSource(StrEnum):
    CSV = "csv"
    WHATSAPP_APP = "whatsapp_app"


class RowOutcome(StrEnum):
    CREATED = "created"
    UPDATED = "updated"
    SKIPPED = "skipped"
    DISCARDED = "discarded"


class SyncType(StrEnum):
    CONTACTS = "smb_app_state_sync"
    HISTORY = "history"


class SyncStatus(StrEnum):
    REQUESTED = "requested"
    FAILED = "failed"
    RECEIVING = "receiving"
    DONE = "done"
    # El negocio no aceptó compartir el historial al conectar el número.
    DECLINED = "declined"


class SelectionMode(StrEnum):
    """Qué parte de una importación pasa a la agenda."""

    ALL = "all"
    # Solo quienes tuvieron conversación en los últimos N días.
    RECENT = "recent"
    # Las filas que se marcaron una por una.
    MANUAL = "manual"


class DuplicatePolicy(StrEnum):
    SKIP = "skip"
    # Completa lo que el contacto existente tiene vacío; nunca pisa un dato.
    FILL_EMPTY = "fill_empty"

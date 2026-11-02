"""Errores del dominio de leads, con el status y el texto que ya veía el cliente."""

from __future__ import annotations

from app.core.errors import Conflict, DomainError, Invalid, NotFound


class LeadNotFound(NotFound):
    code = "lead_not_found"

    def __init__(self, detail: str = "Lead no encontrado") -> None:
        super().__init__(detail)


class LeadAlreadyExists(Conflict):
    code = "lead_already_exists"

    def __init__(self, wa_id: str | None = None) -> None:
        self.wa_id = wa_id
        super().__init__("Ya existe un contacto con ese teléfono")


class SellerNotFound(NotFound):
    """El vendedor elegido no existe o está inactivo."""

    code = "seller_not_found"

    def __init__(self) -> None:
        super().__init__("Vendedor no encontrado o inactivo")


class TagNotAvailable(NotFound):
    code = "tag_not_available"


class LeadMergeError(Invalid):
    status_code = 400
    code = "lead_merge_invalid"


class LeadStageError(DomainError):
    """Base de los errores de etapas (mensaje apto para el usuario)."""

    status_code = 409
    code = "lead_stage_conflict"


class InvalidLeadStageError(LeadStageError):
    """La clave no existe en el negocio o la etapa está desactivada."""

    status_code = 422
    code = "invalid_lead_stage"

    def __init__(self, key: str, *, inactive: bool = False) -> None:
        self.key = key
        self.inactive = inactive
        reason = "está desactivada" if inactive else "no existe"
        super().__init__(f"La etapa {key!r} {reason}")


class LeadStageNotFoundError(LeadStageError):
    status_code = 404
    code = "lead_stage_not_found"


class LeadStageConflictError(LeadStageError):
    pass


class LeadStageInUseError(LeadStageError):
    code = "lead_stage_in_use"


class LeadStageProtectedError(LeadStageError):
    status_code = 400
    code = "lead_stage_protected"

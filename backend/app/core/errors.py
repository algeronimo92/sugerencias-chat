"""Errores de dominio y su traducción única a HTTP.

Un caso de uso levanta un ``DomainError`` con la causa de negocio; la capa
HTTP no repite un ``try/except`` por ruta para elegir el status. El handler
registrado en ``app.bootstrap`` responde ``{"detail", "code"}``: ``detail``
conserva el formato que el frontend ya lee y ``code`` permite reaccionar sin
comparar textos.
"""

from __future__ import annotations

from typing import Any


class DomainError(Exception):
    status_code: int = 400
    code: str = "domain_error"

    def __init__(self, detail: Any = None, *, code: str | None = None) -> None:
        self.detail = detail if detail is not None else self.default_detail()
        if code is not None:
            self.code = code
        super().__init__(self.detail if isinstance(self.detail, str) else self.code)

    def default_detail(self) -> str:
        return self.__doc__.strip().splitlines()[0] if self.__doc__ else self.code

    def to_response(self) -> dict[str, Any]:
        return {"detail": self.detail, "code": self.code}


class Invalid(DomainError):
    """La operación no es válida."""

    status_code = 422
    code = "invalid"


class Unauthorized(DomainError):
    """No autenticado."""

    status_code = 401
    code = "unauthorized"


class Forbidden(DomainError):
    """No tenés permiso para esta operación."""

    status_code = 403
    code = "forbidden"


class NotFound(DomainError):
    """No encontrado."""

    status_code = 404
    code = "not_found"


class Conflict(DomainError):
    """La operación choca con el estado actual."""

    status_code = 409
    code = "conflict"


class Gone(DomainError):
    """El recurso ya no está disponible."""

    status_code = 410
    code = "gone"


class Unavailable(DomainError):
    """Un servicio necesario no está disponible."""

    status_code = 503
    code = "unavailable"

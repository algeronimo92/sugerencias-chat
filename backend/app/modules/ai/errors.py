"""Errores de dominio del módulo de IA."""

from app.core.errors import DomainError


class KnowledgeLimitError(Exception):
    pass


class AssistantError(DomainError):
    """El asistente no pudo responder.

    ``detail`` es ``{code, message}``: el mensaje se muestra tal cual al
    vendedor y el código le dice a la UI si tiene sentido reintentar."""

    def __init__(self, status_code: int, code: str, message: str) -> None:
        self.status_code = status_code
        super().__init__({"code": code, "message": message}, code=code)

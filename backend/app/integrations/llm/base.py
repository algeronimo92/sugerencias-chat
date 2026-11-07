from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol


class LlmError(Exception):
    """El proveedor no respondió o rechazó el pedido. ``retryable`` dice si
    vale la pena pasar al modelo secundario (sí) o si el pedido es inválido
    (no: p. ej. clave rechazada, que falla igual con cualquier modelo del
    mismo proveedor)."""

    def __init__(self, message: str, *, status: int | None = None, retryable: bool = True) -> None:
        super().__init__(message)
        self.status = status
        self.retryable = retryable


@dataclass(frozen=True)
class LlmRequest:
    system: str
    user: str
    # JSON Schema (draft 2020, subconjunto) de la respuesta esperada. Cada
    # proveedor lo traduce a su dialecto.
    schema: dict
    schema_name: str = "respuesta"
    max_output_tokens: int = 8000


@dataclass(frozen=True)
class LlmResult:
    text: str
    model: str
    tokens_in: int | None = None
    tokens_out: int | None = None
    extra: dict = field(default_factory=dict)


class LlmClient(Protocol):
    provider: str
    model: str

    async def complete_json(self, request: LlmRequest) -> LlmResult:
        """Una respuesta que debe ser JSON válido según ``request.schema``."""

    async def ping(self) -> LlmResult:
        """Una llamada mínima para comprobar clave y modelo."""

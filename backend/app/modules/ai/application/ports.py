"""Lo que necesitan los casos de uso del asistente, como puertos.

- ``AiProvider``: el proveedor de IA, hoy los workflows de n8n.
- ``AiAccess``: plan, cuota y configuración de la plataforma.
- ``AiJobs``: los jobs firmados con los que el proveedor responde.
- ``AssistantContext``: la revisión del contexto del lead y la caché de
  sugerencias.

Los implementa ``app.modules.ai.infrastructure.assistant_adapters`` y los
conecta ``app.composition``.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal, Protocol


class AiWorkflowRejected(Exception):
    """El proveedor rechazó la credencial o el workflow no existe: es
    configuración de la plataforma y reintentar no lo arregla."""


class AiProvider(Protocol):
    async def analyze(
        self, chat_id: str, *, job_id: str, context_revision: str, tenant_context_token: str,
    ) -> dict:
        """Corre el analista. El resultado se aplica por el callback scoped
        del job antes de que responda."""

    async def suggest(
        self,
        chat_id: str,
        phone: str | None,
        *,
        refresh: bool,
        instruction: str | None,
        job_id: str,
        context_revision: str,
        tenant_context_token: str,
    ) -> Any:
        """Una sugerencia de respuesta para el vendedor."""


_provider: AiProvider | None = None


def provide_ai_provider(provider: AiProvider) -> None:
    global _provider
    _provider = provider


def ai_provider() -> AiProvider:
    if _provider is None:
        raise RuntimeError("El proveedor de IA no está configurado (app.composition)")
    return _provider


class AiUnavailable(Exception):
    """El negocio no puede generar ahora; ``status_code`` va directo al HTTP."""

    def __init__(self, code: str, message: str, status_code: int):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


class AiJobNotStarted(Exception):
    """El job no pudo crearse (otro pedido lo tomó o cambió de estado)."""


class AiAccess(Protocol):
    async def ensure_available(self, operation: str) -> None:
        """Levanta ``AiUnavailable`` si el negocio no puede generar."""

    async def job_created(self) -> None:
        """Avisos operativos tras crear un job (p. ej. cuota por agotarse)."""


class AiJobs(Protocol):
    async def create(
        self, operation: str, chat_id: str, *, context_revision: str, request_metadata: dict,
    ) -> tuple[Any, Any]:
        """El job y el tenant al que pertenece. Levanta ``AiJobNotStarted``."""

    def sign(self, organization_id: Any, job_id: str, operation: str, expires_at: datetime) -> str:
        """El token del job. Levanta ``RuntimeError`` si falta la clave."""

    async def finish(self, job_id: str, **values: Any) -> Any: ...

    async def get(self, job_id: str) -> Any: ...


class AssistantContext(Protocol):
    async def context_revision(self, chat_id: str) -> str | None: ...

    async def cached_suggestion(self, chat_id: str) -> Any: ...

    async def cache_suggestion_if_current(
        self, chat_id: str, suggestion: dict, context_revision: str,
    ) -> Literal["cached", "stale", "missing"] | str: ...


@dataclass(frozen=True, slots=True)
class AssistantPorts:
    access: AiAccess
    jobs: AiJobs
    context: AssistantContext


_assistant: AssistantPorts | None = None


def provide_assistant_ports(ports: AssistantPorts) -> None:
    global _assistant
    _assistant = ports


def assistant_ports() -> AssistantPorts:
    if _assistant is None:
        raise RuntimeError("Los puertos del asistente no están configurados (app.composition)")
    return _assistant

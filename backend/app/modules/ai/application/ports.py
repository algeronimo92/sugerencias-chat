"""El proveedor de IA: hoy los workflows de n8n de la plataforma."""

from __future__ import annotations

from typing import Any, Protocol


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

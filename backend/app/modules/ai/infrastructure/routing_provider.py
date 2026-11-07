"""Elige por negocio quién genera las sugerencias: n8n (hoy, por defecto) o
el copiloto nativo con las claves del propio negocio. El analista va siempre
a n8n mientras no se migre."""

from __future__ import annotations

from app.modules.platform.ports.settings_service import get_effective

MODE_KEY = "ai_suggestions_mode"


async def suggestions_mode() -> str:
    mode = (await get_effective(MODE_KEY)).strip().lower()
    return "native" if mode == "native" else "n8n"


class RoutingAiProvider:
    def __init__(self, n8n, native) -> None:
        self._n8n = n8n
        self._native = native

    async def analyze(self, chat_id, *, job_id, context_revision, tenant_context_token):
        return await self._n8n.analyze(
            chat_id, job_id=job_id, context_revision=context_revision, tenant_context_token=tenant_context_token,
        )

    async def suggest(self, chat_id, phone, *, refresh, instruction, job_id, context_revision, tenant_context_token):
        provider = self._native if await suggestions_mode() == "native" else self._n8n
        return await provider.suggest(
            chat_id, phone, refresh=refresh, instruction=instruction,
            job_id=job_id, context_revision=context_revision, tenant_context_token=tenant_context_token,
        )

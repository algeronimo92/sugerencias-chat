"""Quién atiende cada operación de IA: las sugerencias las genera el copiloto
nativo con las claves del propio negocio; el analista sigue en n8n mientras
no se migre."""

from __future__ import annotations


class RoutingAiProvider:
    def __init__(self, n8n, native) -> None:
        self._n8n = n8n
        self._native = native

    async def analyze(self, chat_id, *, job_id, context_revision, tenant_context_token):
        return await self._n8n.analyze(
            chat_id, job_id=job_id, context_revision=context_revision, tenant_context_token=tenant_context_token,
        )

    async def suggest(self, chat_id, phone, *, refresh, instruction, job_id, context_revision, tenant_context_token):
        return await self._native.suggest(
            chat_id, phone, refresh=refresh, instruction=instruction,
            job_id=job_id, context_revision=context_revision, tenant_context_token=tenant_context_token,
        )

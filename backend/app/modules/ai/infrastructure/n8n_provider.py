"""El proveedor de IA sobre los workflows de n8n de la plataforma."""

from __future__ import annotations

import httpx

from app.integrations.n8n.client import call_n8n, call_n8n_analyst
from app.modules.ai.application.ports import AiWorkflowRejected

# n8n rechazó la credencial (401/403) o el webhook no existe/no está activo
# (404): es configuración de la plataforma y reintentar no lo arregla.
_REJECTED_STATUSES = frozenset({401, 403, 404})


def _translated(exc: Exception) -> Exception:
    if isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code in _REJECTED_STATUSES:
        return AiWorkflowRejected(str(exc))
    return exc


class N8nAiProvider:
    async def analyze(self, chat_id, *, job_id, context_revision, tenant_context_token):
        try:
            return await call_n8n_analyst(
                chat_id, job_id=job_id, context_revision=context_revision,
                tenant_context_token=tenant_context_token,
            )
        except Exception as exc:
            translated = _translated(exc)
            if translated is exc:
                raise
            raise translated from exc

    async def suggest(self, chat_id, phone, *, refresh, instruction, job_id, context_revision, tenant_context_token):
        try:
            return await call_n8n(
                chat_id, phone, refresh=refresh, instruction=instruction, operation="rag",
                job_id=job_id, context_revision=context_revision, tenant_context_token=tenant_context_token,
            )
        except Exception as exc:
            translated = _translated(exc)
            if translated is exc:
                raise
            raise translated from exc

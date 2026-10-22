"""Adaptadores de los puertos del asistente sobre las piezas del módulo.

Llaman a las funciones por su módulo (``ai_jobs.create_ai_job``) y no por un
import directo, para que un reemplazo del módulo se vea acá.
"""

from __future__ import annotations

from app.modules.ai import ai_access, ai_context, ai_job_tokens, ai_jobs, suggestions_service
from app.modules.ai.application.ports import AiJobNotStarted


class PlatformAiAccess:
    async def ensure_available(self, operation: str) -> None:
        await ai_access.ensure_ai_available(operation)

    async def job_created(self) -> None:
        await ai_access.notify_ai_job_created()


class SqlAiJobs:
    async def create(self, operation, chat_id, *, context_revision, request_metadata):
        try:
            return await ai_jobs.create_ai_job(
                operation,
                chat_id,
                chat_id=chat_id,
                context_revision=context_revision,
                request_metadata=request_metadata,
            )
        except ai_jobs.AIJobConflict as exc:
            raise AiJobNotStarted(str(exc)) from exc

    def sign(self, organization_id, job_id, operation, expires_at) -> str:
        return ai_job_tokens.issue_ai_job_token(organization_id, job_id, operation, expires_at)

    async def finish(self, job_id, **values):
        return await ai_jobs.finish_ai_job(job_id, **values)

    async def get(self, job_id):
        return await ai_jobs.get_ai_job(job_id)


class SqlAssistantContext:
    async def context_revision(self, chat_id):
        return await ai_context.fetch_context_revision(chat_id)

    async def cached_suggestion(self, chat_id):
        return await suggestions_service.get_cached_suggestion(chat_id)

    async def cache_suggestion_if_current(self, chat_id, suggestion, context_revision):
        return await suggestions_service.cache_suggestion_if_current(chat_id, suggestion, context_revision)

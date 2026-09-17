"""Ciclo de vida de jobs IA almacenados dentro del schema tenant."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4

from sqlalchemy import select

from db.models import AIJob
from db.session import get_sessionmaker
from tenancy.context import TenantContext, get_current_tenant


class AIJobError(Exception):
    pass


class AIJobNotFound(AIJobError):
    pass


class AIJobConflict(AIJobError):
    pass


class AIJobExpired(AIJobError):
    pass


async def create_ai_job(
    operation: str,
    resource_id: str,
    *,
    chat_id: str | None,
    context_revision: str,
    request_metadata: dict | None = None,
    ttl_seconds: int = 300,
) -> tuple[AIJob, TenantContext]:
    context = get_current_tenant()
    if context is None:
        raise AIJobConflict("tenant context is required")
    now = datetime.now(timezone.utc)
    job = AIJob(
        id=str(uuid4()),
        operation=operation,
        resource_id=resource_id,
        chat_id=chat_id,
        context_revision=context_revision,
        status="pending",
        created_at=now,
        expires_at=now + timedelta(seconds=ttl_seconds),
        request_metadata=request_metadata or {},
    )
    async with get_sessionmaker()() as session:
        session.add(job)
        await session.commit()
    return job, context


async def start_ai_job(
    job_id: str,
    *,
    operation: str,
    resource_id: str | None = None,
    context_revision: str | None = None,
) -> AIJob:
    """Valida el alcance y marca running; reintentos running son idempotentes."""

    async with get_sessionmaker()() as session:
        job = (
            await session.execute(
                select(AIJob).where(AIJob.id == job_id).with_for_update()
            )
        ).scalar_one_or_none()
        if job is None:
            raise AIJobNotFound(job_id)
        now = datetime.now(timezone.utc)
        if job.expires_at <= now:
            if job.status not in {"applied", "succeeded"}:
                job.status = "expired"
                await session.commit()
            raise AIJobExpired(job_id)
        if job.operation != operation:
            raise AIJobConflict("operation mismatch")
        if resource_id is not None and job.resource_id != resource_id:
            raise AIJobConflict("resource mismatch")
        if context_revision is not None and job.context_revision != context_revision:
            raise AIJobConflict("context revision mismatch")
        if job.status not in {"pending", "running"}:
            raise AIJobConflict(f"job status is {job.status}")
        if job.status == "pending":
            job.status = "running"
            await session.commit()
        return job


async def get_ai_job(job_id: str) -> AIJob | None:
    async with get_sessionmaker()() as session:
        return await session.get(AIJob, job_id)


async def finish_ai_job(
    job_id: str,
    *,
    status: str,
    result: dict | None = None,
    error: str | None = None,
) -> bool:
    if status not in {"succeeded", "failed", "applied"}:
        raise ValueError("invalid terminal AI job status")
    async with get_sessionmaker()() as session:
        job = await session.get(AIJob, job_id, with_for_update=True)
        if job is None:
            return False
        # Un retry tardÃ­o no puede degradar ni volver a aplicar un resultado.
        if job.status == "applied":
            return status == "applied"
        job.status = status
        job.result = result
        job.error = error
        if status == "applied":
            job.applied_at = datetime.now(timezone.utc)
        await session.commit()
    return True

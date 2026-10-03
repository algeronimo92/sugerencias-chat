"""Ciclo de vida de jobs IA almacenados dentro del schema tenant."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4

from sqlalchemy import func, select

from app.db.models.ai import AIJob
from app.db.models.conversations import WspMessage
from app.db.models.leads import Lead
from app.db.uow import current_session, session_scope, unit_of_work
from app.modules.ai.ai_context import make_context_revision
from app.modules.leads.public import Actor, InvalidLeadStageError, change_stage, update_lead
from app.tenancy.context import TenantContext, get_current_tenant


class AIJobError(Exception):
    pass


class AIJobNotFound(AIJobError):
    pass


class AIJobConflict(AIJobError):
    pass


class AIJobExpired(AIJobError):
    pass


class AIContextStale(AIJobError):
    def __init__(self, current_revision: str):
        super().__init__(current_revision)
        self.current_revision = current_revision


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
    async with session_scope() as session:
        session.add(job)
    return job, context


async def start_ai_job(
    job_id: str,
    *,
    operation: str,
    resource_id: str | None = None,
    context_revision: str | None = None,
) -> AIJob:
    """Validate scope and mark running; repeated running calls are idempotent."""

    expired = False
    async with session_scope() as session:
        job = (
            await session.execute(
                select(AIJob).where(AIJob.id == job_id).with_for_update()
            )
        ).scalar_one_or_none()
        if job is None:
            raise AIJobNotFound(job_id)
        now = datetime.now(timezone.utc)
        if job.expires_at <= now:
            # El vencimiento se confirma aunque el llamador reciba un error.
            if job.status not in {"applied", "succeeded"}:
                job.status = "expired"
            expired = True
        else:
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
    if expired:
        raise AIJobExpired(job_id)
    return job


async def get_ai_job(job_id: str) -> AIJob | None:
    async with session_scope() as session:
        return await session.get(AIJob, job_id)


async def record_ai_job_step(job_id: str, step: str) -> bool:
    """Record a trusted backend step using a fresh JSON value."""

    async with session_scope() as session:
        job = await session.get(AIJob, job_id, with_for_update=True)
        if job is None or job.status not in {"pending", "running"}:
            return False
        metadata = dict(job.request_metadata or {})
        completed = list(metadata.get("completed_steps") or [])
        if step not in completed:
            completed.append(step)
        metadata["completed_steps"] = completed
        job.request_metadata = metadata
    return True


async def finish_ai_job(
    job_id: str,
    *,
    status: str,
    result: dict | None = None,
    error: str | None = None,
) -> bool:
    if status not in {"succeeded", "failed", "applied"}:
        raise ValueError("invalid terminal AI job status")
    async with session_scope() as session:
        job = await session.get(AIJob, job_id, with_for_update=True)
        if job is None:
            return False
        # A late retry cannot downgrade or reapply a result.
        if job.status == "applied":
            return status == "applied"
        job.status = status
        job.result = result
        job.error = error
        if status == "applied":
            job.applied_at = datetime.now(timezone.utc)
    return True


class _JobFailure(Exception):
    """Fallo que deja constancia en el job aunque el resultado se revierta."""

    def __init__(self, status: str, error: str | None, cause: Exception) -> None:
        super().__init__(error or status)
        self.status = status
        self.error = error
        self.cause = cause


async def _record_failure(job_id: str, status: str, error: str | None) -> None:
    async with session_scope() as session:
        job = await session.get(AIJob, job_id, with_for_update=True)
        if job is not None and job.status in {"pending", "running"}:
            job.status = status
            job.error = error


async def apply_analysis_job_atomic(
    job_id: str,
    *,
    chat_id: str,
    context_revision: str,
    values: dict,
    stage: str | None,
    reasoning: str | None,
) -> dict:
    """Valida el cursor y aplica campos, etapa, auditoría y job en una sola
    transacción. Los cambios del lead pasan por los comandos de ``leads``:
    las mismas reglas que un cambio desde el kanban."""

    try:
        async with unit_of_work():
            return await _apply_analysis(
                job_id, chat_id=chat_id, context_revision=context_revision,
                values=values, stage=stage, reasoning=reasoning,
            )
    except _JobFailure as failure:
        await _record_failure(job_id, failure.status, failure.error)
        raise failure.cause from None


async def _apply_analysis(
    job_id: str,
    *,
    chat_id: str,
    context_revision: str,
    values: dict,
    stage: str | None,
    reasoning: str | None,
) -> dict:
    session = current_session()
    now = datetime.now(timezone.utc)
    job = (
        await session.execute(select(AIJob).where(AIJob.id == job_id).with_for_update())
    ).scalar_one_or_none()
    if job is None:
        raise AIJobNotFound(job_id)
    if (
        job.operation != "analyst"
        or job.resource_id != chat_id
        or job.context_revision != context_revision
    ):
        raise AIJobConflict("job scope mismatch")
    if job.status == "applied":
        return job.result or {"status": "ok", "job_id": job_id, "applied": True}
    if job.expires_at <= now:
        raise _JobFailure("expired", None, AIJobExpired(job_id))
    if job.status not in {"pending", "running"}:
        raise AIJobConflict("job scope or status mismatch")
    if "context_loaded" not in (job.request_metadata or {}).get("completed_steps", []):
        raise AIJobConflict("analysis context was not loaded through the scoped endpoint")

    lead = (
        await session.execute(select(Lead.updated_at).where(Lead.id == chat_id).with_for_update())
    ).first()
    if lead is None:
        raise AIJobNotFound(chat_id)
    latest_message_id = await session.scalar(
        select(func.max(WspMessage.id)).where(WspMessage.chat_id == chat_id)
    )
    current_revision = make_context_revision(lead[0], latest_message_id)
    if current_revision != context_revision:
        raise _JobFailure("failed", "stale_ai_context", AIContextStale(current_revision))

    actor = Actor.agent()
    changes = (
        await update_lead(chat_id, values, actor=actor, metadata={"job_id": job_id})
        if values else None
    )
    moved = False
    if stage is not None:
        # Una etapa que el negocio no tiene (o desactivó) revierte el
        # resultado entero, incluidos los campos, y marca el job fallido.
        metadata = {"job_id": job_id, **({"reason": reasoning} if reasoning else {})}
        try:
            moved = (await change_stage(
                chat_id, stage, actor=actor, metadata=metadata,
                lost_reason=values.get("razon_perdido") or reasoning,
            )).changed
        except InvalidLeadStageError as exc:
            raise _JobFailure("failed", "invalid_stage", exc) from exc

    result = {
        "status": "ok",
        "job_id": job_id,
        "applied": True,
        "changed": bool(changes or moved),
        "stage": stage,
    }
    job.status = "applied"
    job.result = result
    job.error = None
    job.applied_at = now
    return result

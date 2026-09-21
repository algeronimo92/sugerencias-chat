"""Ciclo de vida de jobs IA almacenados dentro del schema tenant."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4

from sqlalchemy import func, select

from db.models import AIJob, Lead, LeadActivity, LeadStage, WspMessage
from db.session import get_sessionmaker
from domain_types import AutomationTrigger
from services.ai_context import make_context_revision
from services.store.common import _activity_safe, _fmt_ts
from services.store.leads import _activity_insert, _record_activity, _schedule_stage_automations
from tenancy.context import TenantContext, get_current_tenant


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
    """Validate scope and mark running; repeated running calls are idempotent."""

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


async def record_ai_job_step(job_id: str, step: str) -> bool:
    """Record a trusted backend step using a fresh JSON value."""

    async with get_sessionmaker()() as session:
        job = await session.get(AIJob, job_id, with_for_update=True)
        if job is None or job.status not in {"pending", "running"}:
            return False
        metadata = dict(job.request_metadata or {})
        completed = list(metadata.get("completed_steps") or [])
        if step not in completed:
            completed.append(step)
        metadata["completed_steps"] = completed
        job.request_metadata = metadata
        await session.commit()
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
    async with get_sessionmaker()() as session:
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
        await session.commit()
    return True


async def apply_analysis_job_atomic(
    job_id: str,
    *,
    chat_id: str,
    context_revision: str,
    values: dict,
    stage: LeadStage | None,
    reasoning: str | None,
) -> tuple[dict, int]:
    """Validate the cursor and persist fields, stage, audit and job atomically."""

    now = datetime.now(timezone.utc)
    automations_scheduled = 0
    async with get_sessionmaker()() as session:
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
            return job.result or {"status": "ok", "job_id": job_id, "applied": True}, 0
        if job.expires_at <= now:
            job.status = "expired"
            await session.commit()
            raise AIJobExpired(job_id)
        if job.status not in {"pending", "running"}:
            raise AIJobConflict("job scope or status mismatch")
        if "context_loaded" not in (job.request_metadata or {}).get("completed_steps", []):
            raise AIJobConflict("analysis context was not loaded through the scoped endpoint")

        lead = (
            await session.execute(select(Lead).where(Lead.id == chat_id).with_for_update())
        ).scalar_one_or_none()
        if lead is None:
            raise AIJobNotFound(chat_id)
        latest_message_id = await session.scalar(
            select(func.max(WspMessage.id)).where(WspMessage.chat_id == chat_id)
        )
        current_revision = make_context_revision(lead.updated_at, latest_message_id)
        if current_revision != context_revision:
            job.status = "failed"
            job.error = "stale_ai_context"
            await session.commit()
            raise AIContextStale(current_revision)

        changed_values = {
            key: value for key, value in values.items() if getattr(lead, key) != value
        }
        if changed_values:
            old_values = {key: getattr(lead, key) for key in changed_values}
            for key, value in changed_values.items():
                setattr(lead, key, value)
            await _record_activity(
                session,
                chat_id,
                "lead_updated",
                "agent",
                old_value=_activity_safe(old_values),
                new_value=_activity_safe(changed_values),
                metadata={"job_id": job_id},
            )

        stage_changed = stage is not None and lead.estado != stage
        if stage_changed:
            old_stage = lead.estado
            if stage == LeadStage.perdido:
                reason = str(values.get("razon_perdido") or reasoning or "").strip()
                if reason:
                    lead.razon_perdido = reason
            elif old_stage == LeadStage.perdido and "razon_perdido" not in values:
                lead.razon_perdido = None
            lead.estado = stage
            metadata = {"job_id": job_id}
            if reasoning:
                metadata["reason"] = reasoning
            trigger = (
                await session.execute(
                    select(WspMessage.id, WspMessage.content, WspMessage.sent_at)
                    .where(WspMessage.chat_id == chat_id, WspMessage.sender == "cliente")
                    .order_by(WspMessage.sent_at.desc(), WspMessage.id.desc())
                    .limit(1)
                )
            ).mappings().first()
            if trigger is not None:
                content = (trigger["content"] or "").strip()
                metadata["trigger_message"] = {
                    "id": trigger["id"],
                    "content": content[:300] + ("..." if len(content) > 300 else ""),
                    "sent_at": _fmt_ts(trigger["sent_at"]),
                }
            old_value = {"stage": getattr(old_stage, "value", old_stage)}
            new_value = {"stage": stage.value}
            activity_id = (
                await session.execute(
                    _activity_insert(
                        chat_id,
                        AutomationTrigger.STAGE_CHANGED,
                        "agent",
                        None,
                        old_value,
                        new_value,
                        metadata,
                    ).returning(LeadActivity.id)
                )
            ).scalar_one()
            automations_scheduled = await _schedule_stage_automations(
                session, chat_id, activity_id, old_value, new_value
            )

        changed = bool(changed_values or stage_changed)
        if changed:
            lead.updated_at = now
        result = {
            "status": "ok",
            "job_id": job_id,
            "applied": True,
            "changed": changed,
            "stage": stage.value if stage is not None else None,
        }
        job.status = "applied"
        job.result = result
        job.error = None
        job.applied_at = now
        await session.commit()
    return result, automations_scheduled

"""Lado de lectura de las tareas: las listas y el detalle que muestra la app."""

from datetime import datetime, timezone

from sqlalchemy import select

from app.core.time_format import iso_utc
from app.db.models.auth import User
from app.db.models.leads import Lead
from app.db.models.tasks import LeadTask
from app.db.uow import session_scope
from app.modules.tasks.types import TaskStatus


def _task(row):
    return {
        "id": row["id"], "lead_id": row["lead_id"], "lead_name": row["lead_name"],
        "title": row["title"], "description": row["description"], "task_type": row["task_type"],
        "status": row["status"], "priority": row["priority"], "due_at": iso_utc(row["due_at"]),
        "remind_at": iso_utc(row["remind_at"]), "assigned_user_id": row["assigned_user_id"],
        "assigned_user_name": row["assigned_user_name"],
        "is_overdue": (
            row["status"] == TaskStatus.PENDING
            and row["due_at"] < datetime.now(timezone.utc)
        ),
        "created_at": iso_utc(row["created_at"]),
    }


def _task_query():
    return select(
        LeadTask.id, LeadTask.lead_id, Lead.nombre.label("lead_name"), LeadTask.title,
        LeadTask.description, LeadTask.task_type, LeadTask.status, LeadTask.priority,
        LeadTask.due_at, LeadTask.remind_at, LeadTask.assigned_user_id,
        User.name.label("assigned_user_name"), LeadTask.created_at,
    ).join(Lead, Lead.id == LeadTask.lead_id).join(User, User.id == LeadTask.assigned_user_id)


async def list_tasks(
    user_id: int,
    is_admin: bool,
    status: str | None,
    lead_id: str | None,
    assigned_user_id: int | None = None,
    all_users: bool = False,
):
    stmt = _task_query()
    if not is_admin or (not all_users and assigned_user_id is None):
        stmt = stmt.where(LeadTask.assigned_user_id == user_id)
    elif assigned_user_id is not None:
        stmt = stmt.where(LeadTask.assigned_user_id == assigned_user_id)
    if status:
        stmt = stmt.where(LeadTask.status == status)
    if lead_id:
        stmt = stmt.where(LeadTask.lead_id == lead_id)
    stmt = stmt.order_by(LeadTask.due_at.asc()).limit(500)
    async with session_scope() as session:
        return [_task(r) for r in (await session.execute(stmt)).mappings().all()]


async def get_task(task_id: int):
    async with session_scope() as session:
        row = (await session.execute(_task_query().where(LeadTask.id == task_id))).mappings().one_or_none()
    return _task(row) if row else None

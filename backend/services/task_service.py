"""Tareas del vendedor: alta, estado, cierre automático y recordatorios."""

from datetime import datetime, timezone
from sqlalchemy import insert, select, update
from sqlalchemy.exc import IntegrityError
from domain_types import TaskStatus, TaskType
from db.models import Lead, LeadTask, User
from db.session import get_sessionmaker


def _ts(value):
    return value.isoformat().replace("+00:00", "Z") if value else None


def _task(row):
    return {
        "id": row["id"], "lead_id": row["lead_id"], "lead_name": row["lead_name"],
        "title": row["title"], "description": row["description"], "task_type": row["task_type"],
        "status": row["status"], "priority": row["priority"], "due_at": _ts(row["due_at"]),
        "remind_at": _ts(row["remind_at"]), "assigned_user_id": row["assigned_user_id"],
        "assigned_user_name": row["assigned_user_name"],
        "is_overdue": (
            row["status"] == TaskStatus.PENDING
            and row["due_at"] < datetime.now(timezone.utc)
        ),
        "created_at": _ts(row["created_at"]),
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
    async with get_sessionmaker()() as session:
        return [_task(r) for r in (await session.execute(stmt)).mappings().all()]


async def create_task(values: dict, user_id: int):
    now = datetime.now(timezone.utc)
    values = {
        **values,
        "created_by_user_id": user_id,
        "created_at": now,
        "updated_at": now,
        "status": TaskStatus.PENDING,
    }
    async with get_sessionmaker()() as session:
        result = await session.execute(insert(LeadTask).values(**values).returning(LeadTask.id))
        task_id = result.scalar_one()
        await session.commit()
    return await get_task(task_id)


async def get_task(task_id: int):
    async with get_sessionmaker()() as session:
        row = (await session.execute(_task_query().where(LeadTask.id == task_id))).mappings().one_or_none()
    return _task(row) if row else None


async def update_task(task_id: int, values: dict, user_id: int):
    values["updated_at"] = datetime.now(timezone.utc)
    if "remind_at" in values:
        values["reminder_sent_at"] = None
    if values.get("status") == TaskStatus.COMPLETED:
        values.update(completed_at=datetime.now(timezone.utc), completed_by_user_id=user_id)
    elif "status" in values:
        values.update(completed_at=None, completed_by_user_id=None)
        if values["status"] == TaskStatus.PENDING:
            values["reminder_sent_at"] = None
    stmt = update(LeadTask).where(LeadTask.id == task_id).values(**values)
    async with get_sessionmaker()() as session:
        try:
            result = await session.execute(stmt)
            await session.commit()
        except IntegrityError:
            await session.rollback()
            raise
    return await get_task(task_id) if result.rowcount else None


async def complete_reply_tasks(lead_id: str, user_id: int) -> int:
    """Completa los seguimientos que una respuesta real del vendedor satisface.

    No toca llamadas, citas, cotizaciones ni tareas de otro responsable. La
    outbox llama a este helper recién después del ACK de WhatsApp, por lo que
    un envío fallido no hace desaparecer trabajo pendiente.
    """
    now = datetime.now(timezone.utc)
    stmt = (
        update(LeadTask)
        .where(
            LeadTask.lead_id == lead_id,
            LeadTask.assigned_user_id == user_id,
            LeadTask.status == TaskStatus.PENDING,
            LeadTask.task_type.in_([TaskType.FOLLOW_UP, TaskType.WHATSAPP]),
        )
        .values(
            status=TaskStatus.COMPLETED,
            completed_at=now,
            completed_by_user_id=user_id,
            updated_at=now,
        )
    )
    async with get_sessionmaker()() as session:
        result = await session.execute(stmt)
        await session.commit()
    return result.rowcount


async def complete_assigned_seller_reply_tasks(lead_id: str) -> int:
    """Completa seguimientos cuando la respuesta humana llegó desde WhatsApp.

    Un mensaje enviado desde un dispositivo vinculado no trae el usuario del
    CRM que lo escribió. En ese caso la atribución segura es el vendedor que
    tiene asignado el lead. Si el lead no tiene vendedor, o el usuario asignado
    no tiene rol de vendedor, no se completa ninguna tarea.
    """
    now = datetime.now(timezone.utc)
    seller_id = (
        select(Lead.vendedor_id)
        .join(User, User.id == Lead.vendedor_id)
        .where(Lead.id == lead_id, User.role == "vendedor")
        .scalar_subquery()
    )
    stmt = (
        update(LeadTask)
        .where(
            LeadTask.lead_id == lead_id,
            LeadTask.assigned_user_id == seller_id,
            LeadTask.status == TaskStatus.PENDING,
            LeadTask.task_type.in_([TaskType.FOLLOW_UP, TaskType.WHATSAPP]),
        )
        .values(
            status=TaskStatus.COMPLETED,
            completed_at=now,
            completed_by_user_id=seller_id,
            updated_at=now,
        )
    )
    async with get_sessionmaker()() as session:
        result = await session.execute(stmt)
        await session.commit()
    return result.rowcount


async def complete_pending_tasks(
    user_id: int,
    is_admin: bool,
    assigned_user_id: int | None = None,
    all_users: bool = False,
) -> int:
    """Completa en bloque las tareas pendientes visibles para el usuario."""
    now = datetime.now(timezone.utc)
    stmt = update(LeadTask).where(LeadTask.status == TaskStatus.PENDING)
    if not is_admin or (not all_users and assigned_user_id is None):
        stmt = stmt.where(LeadTask.assigned_user_id == user_id)
    elif assigned_user_id is not None:
        stmt = stmt.where(LeadTask.assigned_user_id == assigned_user_id)
    stmt = stmt.values(
        status=TaskStatus.COMPLETED,
        completed_at=now,
        completed_by_user_id=user_id,
        updated_at=now,
    )
    async with get_sessionmaker()() as session:
        result = await session.execute(stmt)
        await session.commit()
    return result.rowcount


async def claim_due_reminders() -> list[dict]:
    """Obtiene y marca recordatorios vencidos en una sola transacción.

    FOR UPDATE SKIP LOCKED evita avisos duplicados si hay más de un worker.
    """
    now = datetime.now(timezone.utc)
    stmt = (
        select(LeadTask, Lead.nombre.label("lead_name"))
        .outerjoin(Lead, Lead.id == LeadTask.lead_id)
        .where(
            LeadTask.status == TaskStatus.PENDING,
            LeadTask.remind_at.is_not(None),
            LeadTask.remind_at <= now,
            LeadTask.reminder_sent_at.is_(None),
        )
        .order_by(LeadTask.remind_at.asc())
        .limit(100)
        .with_for_update(of=LeadTask, skip_locked=True)
    )
    async with get_sessionmaker()() as session:
        rows = (await session.execute(stmt)).all()
        reminders = []
        for task, lead_name in rows:
            task.reminder_sent_at = now
            reminders.append({
                "task_id": task.id,
                "lead_id": task.lead_id,
                "lead_name": lead_name,
                "title": task.title,
                "assigned_user_id": task.assigned_user_id,
                "due_at": _ts(task.due_at),
            })
        if rows:
            await session.commit()
    return reminders


async def release_reminder(task_id: int) -> None:
    """Devuelve el recordatorio a la cola si el responsable no está conectado."""
    async with get_sessionmaker()() as session:
        await session.execute(
            update(LeadTask)
            .where(LeadTask.id == task_id, LeadTask.status == TaskStatus.PENDING)
            .values(reminder_sent_at=None)
        )
        await session.commit()

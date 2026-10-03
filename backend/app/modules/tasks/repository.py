"""Tareas del vendedor: alta, estado, cierre automático y recordatorios."""

from datetime import datetime, timezone
from sqlalchemy import insert, select, update
from sqlalchemy.exc import IntegrityError
from domain_types import TaskStatus, TaskType
from app.db.models.leads import Lead
from app.db.models.tasks import LeadTask
from app.db.models.auth import User
from app.core.time_format import iso_utc
from app.modules.tasks.policies import new_task_values, task_update_values
from app.modules.tasks.queries import get_task
from app.db.uow import session_scope


class MissingTaskReferenceError(Exception):
    """El lead o el responsable que la tarea apunta no existe."""


async def create_task(values: dict, user_id: int):
    now = datetime.now(timezone.utc)
    values = new_task_values(values, user_id, now)
    async with session_scope() as session:
        try:
            result = await session.execute(insert(LeadTask).values(**values).returning(LeadTask.id))
            task_id = result.scalar_one()
            await session.flush()
        except IntegrityError as exc:
            raise MissingTaskReferenceError("Lead o responsable no encontrado") from exc
    return await get_task(task_id)


async def update_task(task_id: int, values: dict, user_id: int):
    values = task_update_values(values, user_id, datetime.now(timezone.utc))
    stmt = update(LeadTask).where(LeadTask.id == task_id).values(**values)
    async with session_scope() as session:
        try:
            result = await session.execute(stmt)
            await session.flush()
        except IntegrityError as exc:
            raise MissingTaskReferenceError("Responsable no encontrado") from exc
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
    async with session_scope() as session:
        result = await session.execute(stmt)
        await session.flush()
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
    async with session_scope() as session:
        result = await session.execute(stmt)
        await session.flush()
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
    async with session_scope() as session:
        result = await session.execute(stmt)
        await session.flush()
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
    async with session_scope() as session:
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
                "due_at": iso_utc(task.due_at),
            })
        if rows:
            await session.flush()
    return reminders


async def release_reminder(task_id: int) -> None:
    """Devuelve el recordatorio a la cola si el responsable no está conectado."""
    async with session_scope() as session:
        await session.execute(
            update(LeadTask)
            .where(LeadTask.id == task_id, LeadTask.status == TaskStatus.PENDING)
            .values(reminder_sent_at=None)
        )
        await session.flush()

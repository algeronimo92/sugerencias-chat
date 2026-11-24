"""Lado de lectura de las tareas: las listas y el detalle que muestra la app."""

from datetime import datetime, timezone

from sqlalchemy import Select, and_, case, func, or_, select

from app.core.time_format import iso_utc
from app.db.models.auth import User
from app.db.models.leads import Lead
from app.db.models.tasks import LeadTask
from app.db.uow import session_scope
from app.modules.tasks.types import TaskPriority, TaskStatus, TaskType


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
        "completed_at": iso_utc(row["completed_at"]),
    }


def _task_query():
    return select(
        LeadTask.id, LeadTask.lead_id, Lead.nombre.label("lead_name"), LeadTask.title,
        LeadTask.description, LeadTask.task_type, LeadTask.status, LeadTask.priority,
        LeadTask.due_at, LeadTask.remind_at, LeadTask.assigned_user_id,
        User.name.label("assigned_user_name"), LeadTask.created_at, LeadTask.completed_at,
    ).join(Lead, Lead.id == LeadTask.lead_id).join(User, User.id == LeadTask.assigned_user_id)


def _scoped(stmt: Select, user_id: int, is_admin: bool, assigned_user_id: int | None, all_users: bool, owner_id: int | None) -> Select:
    """De quién son las tareas que se miran: las propias, las de una persona o
    las de todo el equipo, siempre dentro de los leads que el usuario ve."""
    if owner_id is not None:
        stmt = stmt.where(Lead.vendedor_id == owner_id)
    if not is_admin or (not all_users and assigned_user_id is None):
        return stmt.where(LeadTask.assigned_user_id == user_id)
    if assigned_user_id is not None:
        return stmt.where(LeadTask.assigned_user_id == assigned_user_id)
    return stmt


async def list_tasks(
    user_id: int,
    is_admin: bool,
    status: str | None,
    lead_id: str | None,
    assigned_user_id: int | None = None,
    all_users: bool = False,
    owner_id: int | None = None,
):
    stmt = _scoped(_task_query(), user_id, is_admin, assigned_user_id, all_users, owner_id)
    if status:
        stmt = stmt.where(LeadTask.status == status)
    if lead_id:
        stmt = stmt.where(LeadTask.lead_id == lead_id)
    stmt = stmt.order_by(LeadTask.due_at.asc()).limit(500)
    async with session_scope() as session:
        return [_task(r) for r in (await session.execute(stmt)).mappings().all()]


TASK_BUCKETS = ("overdue", "today", "upcoming")


def _escaped(term: str) -> str:
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _search_condition(search: str):
    """La misma búsqueda que la pantalla hacía en memoria: título, lead,
    descripción, responsable o el nombre del tipo de tarea."""
    term = search.strip().lower()
    pattern = f"%{_escaped(term)}%"
    options = [
        column.ilike(pattern, escape="\\")
        for column in (LeadTask.title, Lead.nombre, LeadTask.description, User.name)
    ]
    types = [task_type for task_type, label in _TYPE_LABELS.items() if term in label.lower()]
    if types:
        options.append(LeadTask.task_type.in_(types))
    return or_(*options)


def _bucket_conditions(now: datetime, day_end: datetime):
    """Vencidas, para hoy y próximas. "Hoy" termina a la medianoche del
    navegador (`day_end`): el servidor no sabe en qué zona horaria trabaja
    cada vendedor, y una tarea de las 23 h no puede caer en "Próximas"."""
    return {
        "overdue": LeadTask.due_at < now,
        "today": and_(LeadTask.due_at >= now, LeadTask.due_at < day_end),
        "upcoming": and_(LeadTask.due_at >= now, LeadTask.due_at >= day_end),
    }


async def list_pending_page(
    user_id: int,
    is_admin: bool,
    *,
    day_end: datetime,
    status: str = "pending",
    search: str | None = None,
    bucket: str | None = None,
    assigned_user_id: int | None = None,
    all_users: bool = False,
    owner_id: int | None = None,
    offset: int = 0,
    limit: int = 50,
) -> dict:
    """Una página de tareas con los contadores de cada grupo. Antes la
    pantalla traía hasta 500 y filtraba en memoria: con más de 500 tareas las
    demás no aparecían en ningún lado (ni en la lista ni en los contadores).

    `status` es "pending", "completed" o "all". Los grupos por vencimiento y
    sus contadores son siempre de las pendientes: una tarea cerrada no vence."""
    if day_end.tzinfo is None:
        day_end = day_end.replace(tzinfo=timezone.utc)
    now = datetime.now(timezone.utc)
    buckets = _bucket_conditions(now, day_end)

    def pending(stmt: Select) -> Select:
        return _scoped(stmt, user_id, is_admin, assigned_user_id, all_users, owner_id).where(
            LeadTask.status == TaskStatus.PENDING,
        )

    base = pending(
        select(func.count()).select_from(LeadTask)
        .join(Lead, Lead.id == LeadTask.lead_id).join(User, User.id == LeadTask.assigned_user_id),
    )
    searched = base.where(_search_condition(search)) if search and search.strip() else base
    counts_stmt = searched.with_only_columns(
        func.count(),
        *(func.count(case((condition, 1))) for condition in buckets.values()),
    )
    scoped_items = _scoped(_task_query(), user_id, is_admin, assigned_user_id, all_users, owner_id)
    if status != "all":
        scoped_items = scoped_items.where(LeadTask.status == status)
    if search and search.strip():
        scoped_items = scoped_items.where(_search_condition(search))
    if bucket and status == "pending":
        scoped_items = scoped_items.where(buckets[bucket])
    total_stmt = select(func.count()).select_from(scoped_items.subquery())
    if status == "pending":
        order = (LeadTask.due_at.asc(), LeadTask.id.asc())
    else:
        # Las pendientes primero, por vencimiento; luego lo último que se cerró.
        is_closed = LeadTask.status != TaskStatus.PENDING
        order = (
            is_closed.asc(), case((~is_closed, LeadTask.due_at)).asc(),
            func.coalesce(LeadTask.completed_at, LeadTask.updated_at).desc(), LeadTask.id.desc(),
        )
    items_stmt = scoped_items.order_by(*order).offset(offset).limit(limit)

    async with session_scope() as session:
        pending_total = (await session.execute(base)).scalar_one()
        counted = (await session.execute(counts_stmt)).one()
        total = (await session.execute(total_stmt)).scalar_one()
        rows = (await session.execute(items_stmt)).mappings().all()
    counts = {"all": counted[0], **dict(zip(TASK_BUCKETS, counted[1:]))}
    return {
        "items": [_task(row) for row in rows],
        "total": total,
        "counts": counts,
        "pending_total": pending_total,
    }


async def get_task(task_id: int):
    async with session_scope() as session:
        row = (await session.execute(_task_query().where(LeadTask.id == task_id))).mappings().one_or_none()
    return _task(row) if row else None


_TYPE_LABELS = {
    TaskType.WHATSAPP: "WhatsApp", TaskType.CALL: "Llamada", TaskType.QUOTE: "Cotización",
    TaskType.APPOINTMENT: "Cita", TaskType.FOLLOW_UP: "Seguimiento", TaskType.OTHER: "Otro",
}
_STATUS_LABELS = {TaskStatus.PENDING: "Pendiente", TaskStatus.COMPLETED: "Completada", TaskStatus.CANCELED: "Cancelada"}
_PRIORITY_LABELS = {TaskPriority.LOW: "Baja", TaskPriority.NORMAL: "Normal", TaskPriority.HIGH: "Alta"}


async def export_tasks() -> list[dict]:
    """Todas las tareas del negocio para el respaldo en Excel, sin el tope de
    500 de la lista: un respaldo incompleto no sirve para irse con los datos."""
    stmt = (
        select(
            Lead.nombre.label("lead_name"), Lead.telefono.label("lead_phone"), LeadTask.title, LeadTask.description,
            LeadTask.task_type, LeadTask.status, LeadTask.priority, LeadTask.due_at,
            User.name.label("assigned_user_name"), LeadTask.created_at, LeadTask.completed_at,
        )
        .join(Lead, Lead.id == LeadTask.lead_id)
        .join(User, User.id == LeadTask.assigned_user_id)
        .order_by(LeadTask.created_at, LeadTask.id)
    )
    async with session_scope() as session:
        rows = (await session.execute(stmt)).mappings().all()
    return [
        {
            **dict(row),
            "task_type": _TYPE_LABELS.get(row["task_type"], row["task_type"]),
            "status": _STATUS_LABELS.get(row["status"], row["status"]),
            "priority": _PRIORITY_LABELS.get(row["priority"], row["priority"]),
        }
        for row in rows
    ]

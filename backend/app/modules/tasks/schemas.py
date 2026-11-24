"""Contratos HTTP de tasks."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel
from app.modules.tasks.types import TaskPriority, TaskStatus, TaskType


class TaskCreate(BaseModel):
    lead_id: str
    title: str
    description: str | None = None
    task_type: TaskType = TaskType.FOLLOW_UP
    priority: TaskPriority = TaskPriority.NORMAL
    due_at: datetime
    remind_at: datetime | None = None
    assigned_user_id: int | None = None


class TaskUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    task_type: TaskType | None = None
    priority: TaskPriority | None = None
    due_at: datetime | None = None
    remind_at: datetime | None = None
    assigned_user_id: int | None = None
    status: TaskStatus | None = None


class TaskItem(BaseModel):
    id: int
    lead_id: str
    lead_name: str | None = None
    title: str
    description: str | None = None
    task_type: TaskType
    status: TaskStatus
    priority: TaskPriority
    due_at: str
    remind_at: str | None = None
    assigned_user_id: int
    assigned_user_name: str
    is_overdue: bool
    created_at: str

TaskBucket = Literal["overdue", "today", "upcoming"]


class TaskCounts(BaseModel):
    all: int
    overdue: int
    today: int
    upcoming: int


class TaskPage(BaseModel):
    items: list[TaskItem]
    # Cuántas hay en el grupo pedido (con la búsqueda aplicada): con esto se
    # calcula el número de páginas.
    total: int
    # Los contadores de los chips, con la búsqueda aplicada.
    counts: TaskCounts
    # Todas las pendientes del responsable elegido, sin búsqueda ni grupo: es
    # lo que afecta "Completar todas".
    pending_total: int


class CompletedTasks(BaseModel):
    completed: int

"""Comandos de tareas. Cada uno corre en su unidad de trabajo y avisa con
``TasksChanged`` una vez confirmado; las lecturas van directo al
repositorio."""

from __future__ import annotations

from app.db.uow import collect, unit_of_work
from app.modules.tasks import repository
from app.modules.tasks.events import TasksChanged
from app.modules.tasks.repository import MissingTaskReferenceError

__all__ = ["MissingTaskReferenceError", "complete_pending_tasks", "create_task", "update_task"]


async def create_task(values: dict, user_id: int) -> dict:
    async with unit_of_work():
        item = await repository.create_task(values, user_id)
        collect(TasksChanged())
    return item


async def update_task(task_id: int, values: dict, user_id: int) -> dict | None:
    async with unit_of_work():
        item = await repository.update_task(task_id, values, user_id)
        if item:
            collect(TasksChanged())
    return item


async def complete_pending_tasks(
    user_id: int, is_admin: bool, assigned_user_id: int | None = None, all_users: bool = False,
) -> int:
    async with unit_of_work():
        completed = await repository.complete_pending_tasks(user_id, is_admin, assigned_user_id, all_users)
        if completed:
            collect(TasksChanged())
    return completed

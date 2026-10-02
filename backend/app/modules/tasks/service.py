"""Named domain use cases; atomic persistence belongs to the repository."""
from __future__ import annotations

from app.modules.tasks import repository
from app.modules.tasks.repository import MissingTaskReferenceError

async def complete_pending_tasks(user_id: int, is_admin: bool, assigned_user_id: int | None=None, all_users: bool=False) -> int:
    return await repository.complete_pending_tasks(user_id, is_admin, assigned_user_id, all_users)

async def create_task(values: dict, user_id: int):
    return await repository.create_task(values, user_id)

async def get_task(task_id: int):
    return await repository.get_task(task_id)

async def list_tasks(user_id: int, is_admin: bool, status: str | None, lead_id: str | None, assigned_user_id: int | None=None, all_users: bool=False):
    return await repository.list_tasks(user_id, is_admin, status, lead_id, assigned_user_id, all_users)

async def update_task(task_id: int, values: dict, user_id: int):
    return await repository.update_task(task_id, values, user_id)

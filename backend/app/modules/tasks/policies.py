"""Transiciones de tareas sin dependencia de SQL ni FastAPI."""

from datetime import datetime

from domain_types import TaskStatus


def new_task_values(values: dict, user_id: int, now: datetime) -> dict:
    return {
        **values,
        "created_by_user_id": user_id,
        "created_at": now,
        "updated_at": now,
        "status": TaskStatus.PENDING,
    }


def task_update_values(values: dict, user_id: int, now: datetime) -> dict:
    values = dict(values)
    values["updated_at"] = now
    if "remind_at" in values:
        values["reminder_sent_at"] = None
    if values.get("status") == TaskStatus.COMPLETED:
        values.update(completed_at=now, completed_by_user_id=user_id)
    elif "status" in values:
        values.update(completed_at=None, completed_by_user_id=None)
        if values["status"] == TaskStatus.PENDING:
            values["reminder_sent_at"] = None
    return values

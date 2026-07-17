from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError

from domain_types import TaskStatus
from db.models import User
from models.schemas import TaskCreate, TaskItem, TaskUpdate
from services.auth_service import get_current_user
from services.productivity_service import create_task, get_task, list_tasks, update_task
from services.ws_manager import manager

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


@router.get("", response_model=list[TaskItem])
async def get_tasks(
    status: str | None = None,
    lead_id: str | None = None,
    assigned_user_id: int | None = None,
    all_users: bool = False,
    user: User = Depends(get_current_user),
):
    if status and status not in frozenset(TaskStatus):
        raise HTTPException(400, "Estado inválido")
    if user.role != "admin" and (assigned_user_id is not None or all_users):
        raise HTTPException(403, "Solo un administrador puede consultar tareas de otros usuarios")
    return await list_tasks(user.id, user.role == "admin", status, lead_id, assigned_user_id, all_users)


@router.post("", response_model=TaskItem, status_code=201)
async def post_task(body: TaskCreate, user: User = Depends(get_current_user)):
    values = body.model_dump()
    values["title"] = values["title"].strip()
    if not values["title"]:
        raise HTTPException(400, "El título es obligatorio")
    values["assigned_user_id"] = values["assigned_user_id"] or user.id
    if user.role != "admin" and values["assigned_user_id"] != user.id:
        raise HTTPException(403, "Solo un administrador puede asignar tareas a otro usuario")
    try:
        item = await create_task(values, user.id)
    except IntegrityError:
        raise HTTPException(404, "Lead o responsable no encontrado")
    await manager.broadcast({"type": "tasks_updated"})
    return item


@router.patch("/{task_id}", response_model=TaskItem)
async def patch_task(task_id: int, body: TaskUpdate, user: User = Depends(get_current_user)):
    current = await get_task(task_id)
    if not current:
        raise HTTPException(404, "Tarea no encontrada")
    if user.role != "admin" and current["assigned_user_id"] != user.id:
        raise HTTPException(403, "No puedes modificar una tarea de otro usuario")
    values = body.model_dump(exclude_unset=True)
    if "assigned_user_id" in values and values["assigned_user_id"] != current["assigned_user_id"] and user.role != "admin":
        raise HTTPException(403, "Solo un administrador puede reasignar tareas")
    try:
        item = await update_task(task_id, values, user.id)
    except IntegrityError:
        raise HTTPException(404, "Responsable no encontrado")
    if not item:
        raise HTTPException(404, "Tarea no encontrada")
    await manager.broadcast({"type": "tasks_updated"})
    return item

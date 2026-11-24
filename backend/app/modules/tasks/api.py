from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query

from app.modules.tasks.types import TaskStatus
from app.modules.auth.public import User
from app.modules.tasks.schemas import CompletedTasks, TaskBucket, TaskCreate, TaskItem, TaskPage, TaskStatusFilter, TaskUpdate
from app.modules.auth.public import Permission, can, get_current_user, require_permission
from app.modules.tasks.queries import get_task, list_pending_page, list_tasks
from app.modules.tasks.service import MissingTaskReferenceError, complete_pending_tasks, create_task, update_task
from app.modules.leads.ports.visibility import ensure_lead_visible, seller_scope

# Ver o tocar tareas de otros es ``team.supervise``.
router = APIRouter(prefix="/api/tasks", tags=["tasks"], dependencies=[Depends(require_permission(Permission.TASKS_USE))])


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
    if not can(user, Permission.TEAM_SUPERVISE) and (assigned_user_id is not None or all_users):
        raise HTTPException(403, "Tu rol no puede consultar tareas de otros usuarios")
    if lead_id:
        await ensure_lead_visible(user, lead_id)
    return await list_tasks(user.id, can(user, Permission.TEAM_SUPERVISE), status, lead_id, assigned_user_id, all_users, owner_id=await seller_scope(user))


@router.get("/page", response_model=TaskPage)
async def get_pending_tasks_page(
    day_end: datetime,
    status: TaskStatusFilter = "pending",
    search: str | None = None,
    bucket: TaskBucket | None = None,
    assigned_user_id: int | None = None,
    all_users: bool = False,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=10, ge=1, le=100),
    user: User = Depends(get_current_user),
):
    """La bandeja de "Tareas", paginada en el servidor y filtrable por estado."""
    if not can(user, Permission.TEAM_SUPERVISE) and (assigned_user_id is not None or all_users):
        raise HTTPException(403, "Tu rol no puede consultar tareas de otros usuarios")
    return await list_pending_page(
        user.id,
        can(user, Permission.TEAM_SUPERVISE),
        day_end=day_end,
        status=status,
        search=search.strip() if search else None,
        bucket=bucket,
        assigned_user_id=assigned_user_id,
        all_users=all_users,
        owner_id=await seller_scope(user),
        offset=offset,
        limit=limit,
    )


@router.post("", response_model=TaskItem, status_code=201)
async def post_task(body: TaskCreate, user: User = Depends(get_current_user)):
    await ensure_lead_visible(user, body.lead_id)
    values = body.model_dump()
    values["title"] = values["title"].strip()
    if not values["title"]:
        raise HTTPException(400, "El título es obligatorio")
    values["assigned_user_id"] = values["assigned_user_id"] or user.id
    if not can(user, Permission.TEAM_SUPERVISE) and values["assigned_user_id"] != user.id:
        raise HTTPException(403, "Tu rol no puede asignar tareas a otro usuario")
    try:
        item = await create_task(values, user.id)
    except MissingTaskReferenceError as exc:
        raise HTTPException(404, str(exc))
    return item


@router.post("/complete-all", response_model=CompletedTasks)
async def post_complete_all_tasks(
    assigned_user_id: int | None = None,
    all_users: bool = False,
    user: User = Depends(get_current_user),
):
    if not can(user, Permission.TEAM_SUPERVISE) and (assigned_user_id is not None or all_users):
        raise HTTPException(403, "Tu rol no puede completar tareas de otros usuarios")
    completed = await complete_pending_tasks(
        user.id,
        can(user, Permission.TEAM_SUPERVISE),
        assigned_user_id,
        all_users,
        owner_id=await seller_scope(user),
    )
    return {"completed": completed}


@router.patch("/{task_id}", response_model=TaskItem)
async def patch_task(task_id: int, body: TaskUpdate, user: User = Depends(get_current_user)):
    current = await get_task(task_id)
    if not current:
        raise HTTPException(404, "Tarea no encontrada")
    await ensure_lead_visible(user, current["lead_id"])
    if not can(user, Permission.TEAM_SUPERVISE) and current["assigned_user_id"] != user.id:
        raise HTTPException(403, "No puedes modificar una tarea de otro usuario")
    values = body.model_dump(exclude_unset=True)
    if "assigned_user_id" in values and values["assigned_user_id"] != current["assigned_user_id"] and not can(user, Permission.TEAM_SUPERVISE):
        raise HTTPException(403, "Tu rol no puede reasignar tareas")
    try:
        item = await update_task(task_id, values, user.id)
    except MissingTaskReferenceError as exc:
        raise HTTPException(404, str(exc))
    if not item:
        raise HTTPException(404, "Tarea no encontrada")
    return item

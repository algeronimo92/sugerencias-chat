from datetime import datetime, timezone

from sqlalchemy import and_, delete, func, insert, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.dialects.postgresql import insert as pg_insert

from db.models import Lead, LeadTask, MessageTemplate, TemplateAttachment, TemplateUserState, User
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
        "is_overdue": row["status"] == "pending" and row["due_at"] < datetime.now(timezone.utc),
        "created_at": _ts(row["created_at"]),
    }


def _task_query():
    return select(
        LeadTask.id, LeadTask.lead_id, Lead.nombre.label("lead_name"), LeadTask.title,
        LeadTask.description, LeadTask.task_type, LeadTask.status, LeadTask.priority,
        LeadTask.due_at, LeadTask.remind_at, LeadTask.assigned_user_id,
        User.name.label("assigned_user_name"), LeadTask.created_at,
    ).join(Lead, Lead.remote_jid == LeadTask.lead_id).join(User, User.id == LeadTask.assigned_user_id)


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
    values = {**values, "created_by_user_id": user_id, "created_at": now, "updated_at": now, "status": "pending"}
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
    if values.get("status") == "completed":
        values.update(completed_at=datetime.now(timezone.utc), completed_by_user_id=user_id)
    elif "status" in values:
        values.update(completed_at=None, completed_by_user_id=None)
        if values["status"] == "pending":
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


async def claim_due_reminders() -> list[dict]:
    """Obtiene y marca recordatorios vencidos en una sola transacción.

    FOR UPDATE SKIP LOCKED evita avisos duplicados si hay más de un worker.
    """
    now = datetime.now(timezone.utc)
    stmt = (
        select(LeadTask)
        .where(
            LeadTask.status == "pending",
            LeadTask.remind_at.is_not(None),
            LeadTask.remind_at <= now,
            LeadTask.reminder_sent_at.is_(None),
        )
        .order_by(LeadTask.remind_at.asc())
        .limit(100)
        .with_for_update(skip_locked=True)
    )
    async with get_sessionmaker()() as session:
        tasks = (await session.execute(stmt)).scalars().all()
        reminders = []
        for task in tasks:
            task.reminder_sent_at = now
            lead_name = await session.scalar(select(Lead.nombre).where(Lead.remote_jid == task.lead_id))
            reminders.append({
                "task_id": task.id,
                "lead_id": task.lead_id,
                "lead_name": lead_name,
                "title": task.title,
                "assigned_user_id": task.assigned_user_id,
                "due_at": _ts(task.due_at),
            })
        await session.commit()
    return reminders


async def release_reminder(task_id: int) -> None:
    """Devuelve el recordatorio a la cola si el responsable no está conectado."""
    async with get_sessionmaker()() as session:
        await session.execute(
            update(LeadTask)
            .where(LeadTask.id == task_id, LeadTask.status == "pending")
            .values(reminder_sent_at=None)
        )
        await session.commit()


def _template(row, attachments: list[dict] | None = None):
    return {
        "id": row["id"], "name": row["name"], "content": row["content"],
        "shortcut": row["shortcut"], "category": row["category"], "stage": row["stage"],
        "task_type": row["task_type"], "service": row["service"], "is_active": row["is_active"],
        "visibility": row["visibility"], "is_favorite": bool(row["is_favorite"]),
        "last_used_at": _ts(row["last_used_at"]), "use_count": int(row["use_count"] or 0),
        "attachments": attachments or [],
    }


async def list_templates(user_id: int, include_inactive=False):
    stmt = (
        select(
            MessageTemplate.id, MessageTemplate.name, MessageTemplate.content, MessageTemplate.shortcut,
            MessageTemplate.category, MessageTemplate.stage, MessageTemplate.task_type,
            MessageTemplate.service, MessageTemplate.is_active, MessageTemplate.visibility,
            TemplateUserState.is_favorite, TemplateUserState.last_used_at, TemplateUserState.use_count,
        )
        .outerjoin(
            TemplateUserState,
            and_(TemplateUserState.template_id == MessageTemplate.id, TemplateUserState.user_id == user_id),
        )
        .where(or_(MessageTemplate.visibility == "global", MessageTemplate.created_by_user_id == user_id))
        .order_by(TemplateUserState.is_favorite.desc().nullslast(), TemplateUserState.last_used_at.desc().nullslast(), MessageTemplate.name)
    )
    if not include_inactive:
        stmt = stmt.where(MessageTemplate.is_active.is_(True))
    async with get_sessionmaker()() as session:
        rows = (await session.execute(stmt)).mappings().all()
        template_ids = [row["id"] for row in rows]
        attachment_rows = (await session.execute(
            select(TemplateAttachment).where(TemplateAttachment.template_id.in_(template_ids))
            .order_by(TemplateAttachment.template_id, TemplateAttachment.position, TemplateAttachment.id)
        )).scalars().all() if template_ids else []
    attachments: dict[int, list[dict]] = {}
    for item in attachment_rows:
        attachments.setdefault(item.template_id, []).append({
            "id": item.id, "media_url": item.media_url, "content_type": item.content_type,
            "filename": item.filename, "position": item.position,
            "library_asset_id": item.library_asset_id,
        })
    return [_template(row, attachments.get(row["id"])) for row in rows]


async def create_template(values: dict, user_id: int):
    now = datetime.now(timezone.utc)
    visibility = values.pop("visibility", "global")
    async with get_sessionmaker()() as session:
        try:
            result = await session.execute(insert(MessageTemplate).values(**values, visibility=visibility, created_by_user_id=user_id, created_at=now, updated_at=now).returning(MessageTemplate.id))
            template_id = result.scalar_one(); await session.commit()
        except IntegrityError:
            await session.rollback(); raise ValueError("El atajo ya existe")
    return next(item for item in await list_templates(user_id, True) if item["id"] == template_id)


async def update_template(template_id: int, values: dict):
    values["updated_at"] = datetime.now(timezone.utc)
    async with get_sessionmaker()() as session:
        try:
            result = await session.execute(update(MessageTemplate).where(MessageTemplate.id == template_id).values(**values))
            await session.commit()
        except IntegrityError:
            await session.rollback(); raise ValueError("El atajo ya existe")
    if not result.rowcount:
        return None
    async with get_sessionmaker()() as session:
        owner_id = await session.scalar(select(MessageTemplate.created_by_user_id).where(MessageTemplate.id == template_id))
    return next((item for item in await list_templates(owner_id, True) if item["id"] == template_id), None)


async def create_personal_template(name: str, content: str, shortcut: str | None, user_id: int):
    return await create_template(
        {"name": name, "content": content, "shortcut": shortcut, "category": "personal", "stage": None,
         "task_type": None, "service": None, "is_active": True, "visibility": "personal"},
        user_id,
    )


async def _visible_template(session, template_id: int, user_id: int):
    return await session.scalar(
        select(MessageTemplate.id).where(
            MessageTemplate.id == template_id,
            MessageTemplate.is_active.is_(True),
            or_(MessageTemplate.visibility == "global", MessageTemplate.created_by_user_id == user_id),
        )
    )


async def set_template_favorite(template_id: int, user_id: int, is_favorite: bool) -> bool:
    async with get_sessionmaker()() as session:
        if not await _visible_template(session, template_id, user_id):
            return False
        stmt = pg_insert(TemplateUserState).values(
            user_id=user_id, template_id=template_id, is_favorite=is_favorite, use_count=0,
        ).on_conflict_do_update(
            index_elements=[TemplateUserState.user_id, TemplateUserState.template_id],
            set_={"is_favorite": is_favorite},
        )
        await session.execute(stmt); await session.commit()
    return True


async def record_template_use(template_id: int, user_id: int) -> bool:
    now = datetime.now(timezone.utc)
    async with get_sessionmaker()() as session:
        if not await _visible_template(session, template_id, user_id):
            return False
        stmt = pg_insert(TemplateUserState).values(
            user_id=user_id, template_id=template_id, is_favorite=False, last_used_at=now, use_count=1,
        ).on_conflict_do_update(
            index_elements=[TemplateUserState.user_id, TemplateUserState.template_id],
            set_={"last_used_at": now, "use_count": TemplateUserState.use_count + 1},
        )
        await session.execute(stmt); await session.commit()
    return True


async def add_template_attachment(
    template_id: int,
    media_url: str,
    content_type: str,
    filename: str,
    library_asset_id: int | None = None,
) -> dict | None:
    now = datetime.now(timezone.utc)
    async with get_sessionmaker()() as session:
        exists = await session.get(MessageTemplate, template_id)
        if not exists:
            return None
        total = await session.scalar(
            select(func.count(TemplateAttachment.id)).where(TemplateAttachment.template_id == template_id)
        )
        if total >= 10:
            raise ValueError("Una plantilla admite como máximo 10 adjuntos")
        position = await session.scalar(
            select(func.coalesce(func.max(TemplateAttachment.position), -1) + 1)
            .where(TemplateAttachment.template_id == template_id)
        )
        result = await session.execute(insert(TemplateAttachment).values(
            template_id=template_id, media_url=media_url, content_type=content_type,
            filename=filename, library_asset_id=library_asset_id,
            position=position, created_at=now,
        ).returning(TemplateAttachment.id))
        attachment_id = result.scalar_one(); await session.commit()
    return {
        "id": attachment_id, "media_url": media_url, "content_type": content_type,
        "filename": filename, "position": position, "library_asset_id": library_asset_id,
    }


async def remove_template_attachment(attachment_id: int) -> dict | None:
    async with get_sessionmaker()() as session:
        row = (await session.execute(
            select(TemplateAttachment.media_url, TemplateAttachment.library_asset_id)
            .where(TemplateAttachment.id == attachment_id)
        )).mappings().one_or_none()
        if row is None:
            return None
        await session.execute(delete(TemplateAttachment).where(TemplateAttachment.id == attachment_id))
        await session.commit()
    return dict(row)

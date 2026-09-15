from datetime import datetime, timezone

from sqlalchemy import delete, func, insert, select, true, update
from sqlalchemy.exc import IntegrityError

from db.models import (
    AutomationRule,
    Lead,
    LeadService,
    LeadTag,
    LeadTagAssignment,
    MessageTemplate,
    User,
)
from db.session import get_sessionmaker
from services.store.common import (
    LeadServiceAlreadyExistsError,
    TagAlreadyExistsError,
    _fmt_ts,
    _tag_dict,
)
from services.store.leads import (
    _record_activity,
)


async def list_tags(include_inactive: bool = False) -> list[dict]:
    stmt = select(
        LeadTag.id,
        LeadTag.name,
        LeadTag.color,
        LeadTag.is_active,
        LeadTag.created_by.label("created_by_user_id"),
        User.name.label("created_by_name"),
        LeadTag.created_at,
    ).outerjoin(User, User.id == LeadTag.created_by).order_by(LeadTag.name.asc())
    if not include_inactive:
        stmt = stmt.where(LeadTag.is_active == true())
    async with get_sessionmaker()() as session:
        rows = (await session.execute(stmt)).mappings().all()
    return [{**dict(row), "created_at": _fmt_ts(row["created_at"])} for row in rows]


async def list_lead_services(include_inactive: bool = False) -> list[dict]:
    stmt = select(
        LeadService.id,
        LeadService.name,
        LeadService.is_active,
        LeadService.created_by.label("created_by_user_id"),
        User.name.label("created_by_name"),
        LeadService.created_at,
    ).outerjoin(User, User.id == LeadService.created_by).order_by(
        func.lower(LeadService.name).asc()
    )
    if not include_inactive:
        stmt = stmt.where(LeadService.is_active == true())
    async with get_sessionmaker()() as session:
        rows = (await session.execute(stmt)).mappings().all()
    return [{**dict(row), "created_at": _fmt_ts(row["created_at"])} for row in rows]


async def create_lead_service(name: str, user_id: int) -> dict:
    now = datetime.now(timezone.utc)
    stmt = (
        insert(LeadService)
        .values(
            name=name,
            is_active=True,
            created_by=user_id,
            created_at=now,
        )
        .returning(
            LeadService.id,
            LeadService.name,
            LeadService.is_active,
            LeadService.created_by.label("created_by_user_id"),
            LeadService.created_at,
        )
    )
    async with get_sessionmaker()() as session:
        try:
            row = (await session.execute(stmt)).mappings().one()
            creator_name = await session.scalar(select(User.name).where(User.id == user_id))
            await session.commit()
        except IntegrityError:
            await session.rollback()
            raise LeadServiceAlreadyExistsError(name)
    return {
        **dict(row),
        "created_by_name": creator_name,
        "created_at": _fmt_ts(row["created_at"]),
    }


def _rename_service_references(value, old_name: str, new_name: str):
    """Renombra referencias exactas dentro del JSON de automatizaciones.

    No reemplaza texto libre ni mensajes: solo acciones ``change_service`` y
    condiciones ``service_contains`` cuyo valor completo era el nombre viejo.
    """
    if isinstance(value, list):
        changed = False
        result = []
        for item in value:
            next_item, item_changed = _rename_service_references(item, old_name, new_name)
            result.append(next_item)
            changed = changed or item_changed
        return result, changed
    if not isinstance(value, dict):
        return value, False

    changed = False
    result = {}
    for key, item in value.items():
        next_item, item_changed = _rename_service_references(item, old_name, new_name)
        result[key] = next_item
        changed = changed or item_changed

    service = result.get("service")
    if (
        result.get("type") == "change_service"
        and isinstance(service, str)
        and service.casefold() == old_name.casefold()
    ):
        result["service"] = new_name
        changed = True
    condition = result.get("service_contains")
    if isinstance(condition, str) and condition.casefold() == old_name.casefold():
        result["service_contains"] = new_name
        changed = True
    return result, changed


async def update_lead_service(
    service_id: int,
    values: dict,
    actor_user_id: int | None = None,
) -> dict | None:
    async with get_sessionmaker()() as session:
        current = (
            await session.execute(
                select(
                    LeadService.id,
                    LeadService.name,
                    LeadService.is_active,
                    LeadService.created_by.label("created_by_user_id"),
                    User.name.label("created_by_name"),
                    LeadService.created_at,
                ).outerjoin(User, User.id == LeadService.created_by).where(LeadService.id == service_id)
            )
        ).mappings().first()
        if current is None:
            return None
        if not values:
            return {**dict(current), "created_at": _fmt_ts(current["created_at"])}

        try:
            row = (
                await session.execute(
                    update(LeadService)
                    .where(LeadService.id == service_id)
                    .values(**values)
                    .returning(LeadService.id, LeadService.name, LeadService.is_active)
                )
            ).mappings().one()

            old_name = current["name"]
            new_name = values.get("name")
            if new_name and new_name != old_name:
                old_match = old_name.lower()
                affected_lead_ids = (
                    await session.execute(
                        select(Lead.id).where(
                            func.lower(func.btrim(Lead.servicio_interes)) == old_match
                        )
                    )
                ).scalars().all()
                await session.execute(
                    update(Lead)
                    .where(func.lower(func.btrim(Lead.servicio_interes)) == old_match)
                    .values(servicio_interes=new_name, updated_at=datetime.now(timezone.utc))
                )
                for lead_id in affected_lead_ids:
                    await _record_activity(
                        session,
                        lead_id,
                        "lead_updated",
                        "user" if actor_user_id is not None else "system",
                        actor_user_id,
                        old_value={"servicio_interes": old_name},
                        new_value={"servicio_interes": new_name},
                        metadata={"source": "service_catalog", "service_id": service_id},
                    )
                await session.execute(
                    update(MessageTemplate)
                    .where(func.lower(func.btrim(MessageTemplate.service)) == old_match)
                    .values(service=new_name)
                )

                rules = (
                    await session.execute(
                        select(
                            AutomationRule.id,
                            AutomationRule.conditions,
                            AutomationRule.actions,
                            AutomationRule.flow_definition,
                            AutomationRule.published_flow_definition,
                        )
                    )
                ).mappings().all()
                for rule in rules:
                    rule_values = {}
                    for field in (
                        "conditions",
                        "actions",
                        "flow_definition",
                        "published_flow_definition",
                    ):
                        next_value, changed = _rename_service_references(
                            rule[field], old_name, new_name
                        )
                        if changed:
                            rule_values[field] = next_value
                    if rule_values:
                        await session.execute(
                            update(AutomationRule)
                            .where(AutomationRule.id == rule["id"])
                            .values(**rule_values)
                        )
            await session.commit()
        except IntegrityError:
            await session.rollback()
            raise LeadServiceAlreadyExistsError(values.get("name", ""))
    return {
        **dict(row),
        "created_by_user_id": current["created_by_user_id"],
        "created_by_name": current["created_by_name"],
        "created_at": _fmt_ts(current["created_at"]),
    }


async def create_tag(name: str, color: str, user_id: int) -> dict:
    now = datetime.now(timezone.utc)
    stmt = (
        insert(LeadTag)
        .values(
            name=name,
            color=color,
            is_active=True,
            created_by=user_id,
            created_at=now,
        )
        .returning(
            LeadTag.id,
            LeadTag.name,
            LeadTag.color,
            LeadTag.is_active,
            LeadTag.created_by.label("created_by_user_id"),
            LeadTag.created_at,
        )
    )
    async with get_sessionmaker()() as session:
        try:
            row = (await session.execute(stmt)).mappings().one()
            creator_name = await session.scalar(select(User.name).where(User.id == user_id))
            await session.commit()
        except IntegrityError:
            await session.rollback()
            raise TagAlreadyExistsError(name)
    return {
        **dict(row),
        "created_by_name": creator_name,
        "created_at": _fmt_ts(row["created_at"]),
    }


async def update_tag(tag_id: int, values: dict) -> dict | None:
    async with get_sessionmaker()() as session:
        current = (
            await session.execute(
                select(
                    LeadTag.id,
                    LeadTag.name,
                    LeadTag.color,
                    LeadTag.is_active,
                    LeadTag.created_by.label("created_by_user_id"),
                    User.name.label("created_by_name"),
                    LeadTag.created_at,
                ).outerjoin(User, User.id == LeadTag.created_by).where(LeadTag.id == tag_id)
            )
        ).mappings().first()
        if current is None:
            return None
        if not values:
            return {**dict(current), "created_at": _fmt_ts(current["created_at"])}
        try:
            row = (
                await session.execute(
                    update(LeadTag)
                    .where(LeadTag.id == tag_id)
                    .values(**values)
                    .returning(LeadTag.id, LeadTag.name, LeadTag.color, LeadTag.is_active)
                )
            ).mappings().first()
            await session.commit()
        except IntegrityError:
            await session.rollback()
            raise TagAlreadyExistsError(values.get("name", ""))
    return {
        **dict(row),
        "created_by_user_id": current["created_by_user_id"],
        "created_by_name": current["created_by_name"],
        "created_at": _fmt_ts(current["created_at"]),
    } if row else None


async def assign_tag(chat_id: str, tag_id: int, user_id: int | None) -> bool:
    async with get_sessionmaker()() as session:
        lead_exists = (await session.execute(select(Lead.id).where(Lead.id == chat_id))).first()
        tag = (
            await session.execute(
                select(LeadTag.id, LeadTag.name, LeadTag.color).where(
                    LeadTag.id == tag_id, LeadTag.is_active == true()
                )
            )
        ).mappings().first()
        if lead_exists is None or tag is None:
            return False
        existing = (
            await session.execute(
                select(LeadTagAssignment.tag_id).where(
                    LeadTagAssignment.lead_id == chat_id,
                    LeadTagAssignment.tag_id == tag_id,
                )
            )
        ).first()
        if existing is None:
            await session.execute(
                insert(LeadTagAssignment).values(
                    lead_id=chat_id,
                    tag_id=tag_id,
                    assigned_by=user_id,
                    assigned_at=datetime.now(timezone.utc),
                )
            )
            await _record_activity(
                session,
                chat_id,
                "tag_added",
                "user" if user_id is not None else "system",
                user_id,
                new_value={"tag": _tag_dict(tag)},
            )
            await session.commit()
        return True


async def remove_tag(chat_id: str, tag_id: int, user_id: int | None) -> bool:
    async with get_sessionmaker()() as session:
        tag = (
            await session.execute(
                select(LeadTag.id, LeadTag.name, LeadTag.color)
                .join(LeadTagAssignment, LeadTagAssignment.tag_id == LeadTag.id)
                .where(LeadTagAssignment.lead_id == chat_id, LeadTag.id == tag_id)
            )
        ).mappings().first()
        if tag is None:
            return False
        await session.execute(
            delete(LeadTagAssignment).where(
                LeadTagAssignment.lead_id == chat_id,
                LeadTagAssignment.tag_id == tag_id,
            )
        )
        await _record_activity(
            session,
            chat_id,
            "tag_removed",
            "user" if user_id is not None else "system",
            user_id,
            old_value={"tag": _tag_dict(tag)},
        )
        await session.commit()
        return True

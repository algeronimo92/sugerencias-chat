"""Plantillas de mensaje: catálogo, favoritos, uso y adjuntos."""

from datetime import datetime, timezone
from sqlalchemy import and_, delete, func, insert, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.dialects.postgresql import insert as pg_insert
from domain_types import AutomationExecutionStatus
from db.models import (
    AutomationExecution,
    AutomationFlowVersion,
    AutomationRule,
    MediaAsset,
    MessageTemplate,
    TemplateAttachment,
    TemplateUserState,
    User,
)
from db.session import get_sessionmaker
from services.time_format import iso_utc


def _template(row, attachments: list[dict] | None = None):
    return {
        "id": row["id"], "name": row["name"], "content": row["content"],
        "shortcut": row["shortcut"], "category": row["category"], "stage": row["stage"],
        "task_type": row["task_type"], "service": row["service"], "is_active": row["is_active"],
        "visibility": row["visibility"], "is_favorite": bool(row["is_favorite"]),
        "template_type": row["template_type"], "official_name": row["official_name"],
        "official_language": row["official_language"], "official_category": row["official_category"],
        "official_status": row["official_status"],
        "official_rejected_reason": row["official_rejected_reason"],
        "official_parameter_values": row["official_parameter_values"] or [],
        "meta_template_id": row["meta_template_id"],
        "official_header_type": row["official_header_type"],
        "official_header_text": row["official_header_text"],
        "official_header_media_asset_id": row["official_header_media_asset_id"],
        "official_header_media_url": row["official_header_media_url"],
        "official_header_media_content_type": row["official_header_media_content_type"],
        "official_header_media_filename": row["official_header_media_filename"],
        "official_footer": row["official_footer"],
        "official_buttons": row["official_buttons"] or [],
        "interactive_type": row["interactive_type"],
        "interactive_config": row["interactive_config"] or {},
        "imported_from_meta": bool(row["imported_from_meta"]),
        "last_used_at": iso_utc(row["last_used_at"]), "use_count": int(row["use_count"] or 0),
        "created_by_user_id": row["created_by_user_id"],
        "created_by_name": row["created_by_name"],
        "created_at": iso_utc(row["created_at"]),
        "attachments": attachments or [],
    }


async def list_templates(user_id: int, include_inactive=False):
    stmt = (
        select(
            MessageTemplate.id, MessageTemplate.name, MessageTemplate.content, MessageTemplate.shortcut,
            MessageTemplate.category, MessageTemplate.stage, MessageTemplate.task_type,
            MessageTemplate.service, MessageTemplate.is_active, MessageTemplate.visibility,
            MessageTemplate.template_type, MessageTemplate.official_name,
            MessageTemplate.official_language, MessageTemplate.official_category,
            MessageTemplate.official_status, MessageTemplate.official_rejected_reason,
            MessageTemplate.official_parameter_values,
            MessageTemplate.meta_template_id, MessageTemplate.official_header_type,
            MessageTemplate.official_header_text, MessageTemplate.official_header_media_asset_id,
            MediaAsset.media_url.label("official_header_media_url"),
            MediaAsset.content_type.label("official_header_media_content_type"),
            MediaAsset.filename.label("official_header_media_filename"),
            MessageTemplate.official_footer,
            MessageTemplate.official_buttons,
            MessageTemplate.interactive_type, MessageTemplate.interactive_config,
            MessageTemplate.imported_from_meta,
            MessageTemplate.created_by_user_id, User.name.label("created_by_name"),
            MessageTemplate.created_at,
            TemplateUserState.is_favorite, TemplateUserState.last_used_at, TemplateUserState.use_count,
        )
        .outerjoin(
            TemplateUserState,
            and_(TemplateUserState.template_id == MessageTemplate.id, TemplateUserState.user_id == user_id),
        )
        .outerjoin(MediaAsset, MediaAsset.id == MessageTemplate.official_header_media_asset_id)
        .join(User, User.id == MessageTemplate.created_by_user_id)
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


def _references_template(value: object, template_id: int) -> bool:
    """Busca referencias dentro de acciones simples o definiciones visuales."""
    if isinstance(value, dict):
        raw_template_id = value.get("template_id")
        try:
            if raw_template_id is not None and int(raw_template_id) == template_id:
                return True
        except (TypeError, ValueError):
            pass
        return any(_references_template(item, template_id) for item in value.values())
    if isinstance(value, list):
        return any(_references_template(item, template_id) for item in value)
    return False


async def delete_template(template_id: int) -> dict | None:
    """Elimina una plantilla solo cuando ninguna automatización vigente la necesita.

    También revisa versiones visuales usadas por ejecuciones pendientes para no
    convertir una espera ya programada en una ejecución rota. Devuelve la
    metadata oficial de la plantilla borrada (para que el router pueda
    limpiarla también del lado de Meta) o `None` si no existía."""
    async with get_sessionmaker()() as session:
        template = (await session.execute(
            select(MessageTemplate).where(MessageTemplate.id == template_id).with_for_update()
        )).scalar_one_or_none()
        if template is None:
            return None

        rules = (await session.execute(select(
            AutomationRule.id,
            AutomationRule.name,
            AutomationRule.actions,
            AutomationRule.flow_definition,
            AutomationRule.published_flow_definition,
        ).where(AutomationRule.deleted_at.is_(None)))).mappings().all()
        blockers = {
            row["id"]: row["name"]
            for row in rules
            if any(_references_template(value, template_id) for value in (
                row["actions"], row["flow_definition"], row["published_flow_definition"],
            ))
        }

        rule_names = {row["id"]: row["name"] for row in rules}
        if rule_names:
            pending = (await session.execute(select(
                AutomationExecution.rule_id,
                AutomationExecution.flow_state,
            ).where(
                AutomationExecution.rule_id.in_(list(rule_names)),
                AutomationExecution.status.in_([
                    AutomationExecutionStatus.SCHEDULED,
                    AutomationExecutionStatus.RUNNING,
                ]),
            ))).mappings().all()
            required_versions = {
                (row["rule_id"], int((row["flow_state"] or {}).get("flow_version") or 0))
                for row in pending
                if (row["flow_state"] or {}).get("flow_version")
            }
            if required_versions:
                versions = (await session.execute(select(
                    AutomationFlowVersion.rule_id,
                    AutomationFlowVersion.version,
                    AutomationFlowVersion.definition,
                ).where(
                    AutomationFlowVersion.rule_id.in_({rule_id for rule_id, _ in required_versions})
                ))).mappings().all()
                for row in versions:
                    if (
                        (row["rule_id"], row["version"]) in required_versions
                        and _references_template(row["definition"], template_id)
                    ):
                        blockers[row["rule_id"]] = rule_names[row["rule_id"]]

        if blockers:
            names = list(dict.fromkeys(blockers.values()))
            visible = ", ".join(names[:3])
            suffix = f" y {len(names) - 3} más" if len(names) > 3 else ""
            raise ValueError(
                f"La plantilla está usada por: {visible}{suffix}. "
                "Edita o elimina esas automatizaciones antes de borrar la plantilla."
            )

        await session.execute(delete(MessageTemplate).where(MessageTemplate.id == template_id))
        await session.commit()
    return {
        "template_type": template.template_type,
        "official_name": template.official_name,
        "meta_template_id": template.meta_template_id,
        "imported_from_meta": template.imported_from_meta,
    }


async def create_personal_template(name: str, content: str, shortcut: str | None, user_id: int):
    return await create_template(
        {"name": name, "content": content, "shortcut": shortcut, "category": "personal", "stage": None,
         "task_type": None, "service": None, "is_active": True, "visibility": "personal",
         "template_type": "internal", "official_parameter_values": [],
         "interactive_type": "none", "interactive_config": {}},
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
        if exists.template_type == "official" or exists.interactive_type != "none":
            raise ValueError(
                "Las plantillas oficiales o interactivas no usan adjuntos internos"
            )
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

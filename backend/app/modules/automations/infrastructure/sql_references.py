"""``ReferenceChecker`` sobre PostgreSQL: si lo que menciona una regla existe
y se puede usar."""

from __future__ import annotations

from sqlalchemy import select

from app.db.models.auth import User
from app.db.models.catalogs import LeadTag, MessageTemplate
from app.db.models.media import MediaAsset
from app.db.uow import session_scope
from app.modules.catalogs.ports.types import InteractiveType, TemplateType
from app.modules.leads.ports.stages import InvalidLeadStageError, verify_stage_keys


class SqlReferenceChecker:
    async def inactive_users(self, ids: set[int]) -> set[int]:
        async with session_scope() as session:
            found = set((await session.execute(
                select(User.id).where(User.id.in_(ids), User.is_active.is_(True))
            )).scalars().all())
        return set(ids) - found

    async def inactive_tags(self, ids: set[int]) -> set[int]:
        async with session_scope() as session:
            found = set((await session.execute(
                select(LeadTag.id).where(LeadTag.id.in_(ids), LeadTag.is_active.is_(True))
            )).scalars().all())
        return set(ids) - found

    async def unusable_templates(self, ids: set[int]) -> set[int]:
        async with session_scope() as session:
            templates = (await session.execute(
                select(MessageTemplate).where(MessageTemplate.id.in_(ids))
            )).scalars().all()
        valid = {
            template.id for template in templates
            if template.is_active
            and template.template_type == TemplateType.INTERNAL
            and template.interactive_type == InteractiveType.NONE
        }
        return set(ids) - valid

    async def missing_media_assets(self, ids: set[int]) -> set[int]:
        async with session_scope() as session:
            found = set((await session.execute(
                select(MediaAsset.id).where(MediaAsset.id.in_(ids))
            )).scalars().all())
        return set(ids) - found

    async def stage_problem(self, keys: set[str], *, active_only: bool) -> str | None:
        async with session_scope() as session:
            try:
                await verify_stage_keys(session, keys, active_only=active_only)
            except InvalidLeadStageError as exc:
                return str(exc)
        return None

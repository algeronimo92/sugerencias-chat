"""``ReferenceChecker`` sobre PostgreSQL: si lo que menciona una regla existe
y se puede usar."""

from __future__ import annotations

from sqlalchemy import select

from app.db.models.auth import User
from app.db.models.catalogs import LeadTag, MessageTemplate
from app.db.models.media import MediaAsset
from app.db.uow import session_scope
from app.modules.automations.domain.templates import automatic_template_problem
from app.modules.leads.ports.stages import stage_problem


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
                select(
                    MessageTemplate.id, MessageTemplate.content, MessageTemplate.is_active,
                    MessageTemplate.template_type, MessageTemplate.interactive_type,
                    MessageTemplate.official_status, MessageTemplate.official_parameter_values,
                ).where(MessageTemplate.id.in_(ids))
            )).mappings().all()
        valid = {template["id"] for template in templates if automatic_template_problem(template) is None}
        return set(ids) - valid

    async def missing_media_assets(self, ids: set[int]) -> set[int]:
        async with session_scope() as session:
            found = set((await session.execute(
                select(MediaAsset.id).where(MediaAsset.id.in_(ids))
            )).scalars().all())
        return set(ids) - found

    async def stage_problem(self, keys: set[str], *, active_only: bool) -> str | None:
        return await stage_problem(keys, active_only=active_only)

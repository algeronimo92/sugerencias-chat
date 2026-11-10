"""El paquete inicial contra PostgreSQL real: siembra, idempotencia y que no
pise lo que el negocio ya cargó. Se salta sin Postgres local, como el resto."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import func, select, update

from app.db.models.auth import User
from app.db.models.automations import AutomationRule
from app.db.models.catalogs import LeadService, LeadTag, MessageTemplate, ServicePackage
from app.db.uow import session_scope
from app.modules.platform.onboarding import onboarding_status
from app.modules.platform.starter_pack import (
    STARTER_AUTOMATIONS,
    STARTER_TAGS,
    STARTER_TEMPLATES,
    apply_starter_pack,
)
from app.tenancy.context import tenant_context
from tests.postgres_fixtures import app_engine, pg_dsn, tenant  # noqa: F401


async def _admin() -> int:
    async with session_scope() as session:
        user = User(
            email=f"admin-{uuid4().hex[:8]}@example.test", name="Admin", password_hash="!",
            role="admin", is_active=True, created_at=datetime.now(timezone.utc),
        )
        session.add(user)
        await session.flush()
        return user.id


async def test_pack_seeds_once_and_never_overwrites(tenant) -> None:
    with tenant_context(tenant):
        admin_id = await _admin()
        # El negocio ya tenía una etiqueta con el mismo nombre (otro color).
        async with session_scope() as session:
            session.add(LeadTag(
                name="primera consulta", color="#000000", is_active=True,
                created_at=datetime.now(timezone.utc),
            ))

        first = await apply_starter_pack()
        second = await apply_starter_pack()

        assert first["tags"] == len(STARTER_TAGS) - 1
        assert first["templates"] == len(STARTER_TEMPLATES)
        assert first["automations"] == len(STARTER_AUTOMATIONS)
        assert first["needs_admin"] == 0
        assert {k: v for k, v in second.items()} == {
            "tags": 0, "categories": 0, "templates": 0, "automations": 0, "needs_admin": 0,
        }

        async with session_scope() as session:
            kept = await session.scalar(
                select(LeadTag.color).where(func.lower(LeadTag.name) == "primera consulta")
            )
            shortcuts = set((await session.execute(
                select(MessageTemplate.shortcut).where(MessageTemplate.visibility == "global")
            )).scalars())
            rules = (await session.execute(
                select(AutomationRule.is_active, AutomationRule.created_by_user_id)
            )).all()

        assert kept == "#000000"
        assert {t["shortcut"] for t in STARTER_TEMPLATES} <= shortcuts
        assert rules and all(not active and owner == admin_id for active, owner in rules)


async def test_pack_without_admin_leaves_templates_for_later(tenant) -> None:
    with tenant_context(tenant):
        result = await apply_starter_pack()
        assert result["templates"] == 0 and result["automations"] == 0
        assert result["needs_admin"] == 1

        await _admin()
        later = await apply_starter_pack()
        assert later["templates"] == len(STARTER_TEMPLATES)
        assert later["tags"] == 0


async def test_checklist_reads_real_catalog_and_team(tenant) -> None:
    with tenant_context(tenant):
        await _admin()
        await apply_starter_pack()

        status = await onboarding_status()
        steps = {step["key"]: step["done"] for step in status["steps"]}
        assert steps == {
            "whatsapp": False, "team": False, "services": False,
            "google_calendar": False, "templates": False,
        }

        async with session_scope() as session:
            service = LeadService(name="Limpieza facial", is_active=True)
            session.add(service)
            await session.flush()
            session.add(ServicePackage(service_id=service.id, name="1 sesión", sessions=1, price=120))
            session.add(User(
                email=f"vend-{uuid4().hex[:8]}@example.test", name="Vendedora", password_hash="!",
                role="vendedor", is_active=False, created_at=datetime.now(timezone.utc),
            ))
            await session.execute(
                update(MessageTemplate)
                .where(MessageTemplate.shortcut == "hola")
                .values(updated_at=func.now() + func.make_interval(0, 0, 0, 0, 0, 0, 5))
            )

        steps = {step["key"]: step["done"] for step in (await onboarding_status())["steps"]}
        assert steps["services"] and steps["team"] and steps["templates"]

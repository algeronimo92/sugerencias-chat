"""Reparto automático de leads nuevos contra un PostgreSQL real.

Las altas concurrentes son el caso que importa: sin el lock del reparto, dos
leads que llegan a la vez eligen al mismo vendedor "menos reciente". Se salta
si no hay Postgres local (ver ``test_tenant_postgres_integration``).
"""

from __future__ import annotations

import asyncio
from collections import Counter
from datetime import datetime, timezone

import pytest
from sqlalchemy import select

from app.db.models.auth import User
from app.db.models.leads import Lead, LeadActivity
from app.db.session import get_sessionmaker
from app.integrations.whatsapp.identity import ContactIdentity, resolve_whatsapp_identity
from app.modules.leads.assignment import AUTO_ASSIGN_REASON
from app.modules.leads.public import Actor, create_lead
from app.modules.platform.settings_service import update_settings
from app.tenancy.context import tenant_context
from tests.test_meta_webhook_postgres import real_engine, tenant  # noqa: F401
from tests.test_tenant_postgres_integration import pg_dsn  # noqa: F401


async def _seed_users() -> dict[str, int]:
    now = datetime.now(timezone.utc)
    users = {
        "ana": User(email="ana@test", name="Ana", password_hash="x", role="vendedor", is_active=True, created_at=now),
        "beto": User(email="beto@test", name="Beto", password_hash="x", role="vendedor", is_active=True, created_at=now),
        "caro": User(email="caro@test", name="Caro", password_hash="x", role="vendedor", is_active=True, created_at=now),
        "inactivo": User(email="i@test", name="Inactivo", password_hash="x", role="vendedor", is_active=False, created_at=now),
        "admin": User(email="admin@test", name="Admin", password_hash="x", role="admin", is_active=True, created_at=now),
    }
    async with get_sessionmaker()() as session:
        session.add_all(users.values())
        await session.commit()
        return {key: user.id for key, user in users.items()}


def _contact(phone_number_id: str, n: int) -> ContactIdentity:
    return ContactIdentity(phone_number_id=phone_number_id, wa_id=f"5199900{n:04d}", user_id=None)


async def _leads(ids: list[str]) -> list[Lead]:
    async with get_sessionmaker()() as session:
        return list((await session.execute(select(Lead).where(Lead.id.in_(ids)))).scalars())


@pytest.mark.asyncio
async def test_concurrent_new_leads_are_spread_evenly_and_audited(tenant) -> None:  # noqa: F811
    context, phone_number_id, _ids = tenant
    with tenant_context(context):
        users = await _seed_users()
        await update_settings({
            "auto_assign_leads_enabled": "true",
            "auto_assign_excluded_user_ids": str(users["caro"]),
        })

        resolved = await asyncio.gather(*(
            resolve_whatsapp_identity(_contact(phone_number_id, n)) for n in range(6)
        ))
        lead_ids = [item.chat_id for item in resolved]
        leads = await _leads(lead_ids)

        assert all(item.lead_created for item in resolved)
        # Solo los vendedores activos y no excluidos, en partes iguales.
        assert Counter(lead.vendedor_id for lead in leads) == {users["ana"]: 3, users["beto"]: 3}
        names = {users["ana"]: "Ana", users["beto"]: "Beto"}
        assert all(lead.vendedor == names[lead.vendedor_id] for lead in leads)

        async with get_sessionmaker()() as session:
            activity = list((await session.execute(
                select(LeadActivity).where(LeadActivity.lead_id.in_(lead_ids))
            )).scalars())
        assigned = [row for row in activity if (row.new_value or {}).get("vendedor_id")]
        assert len(assigned) == 6
        assert all(row.actor_type == "system" for row in assigned)
        assert all(row.metadata_ == {"motivo": AUTO_ASSIGN_REASON} for row in assigned)


@pytest.mark.asyncio
async def test_existing_and_manual_leads_are_not_reassigned(tenant) -> None:  # noqa: F811
    context, phone_number_id, _ids = tenant
    with tenant_context(context):
        users = await _seed_users()
        await update_settings({"auto_assign_leads_enabled": "true"})

        first = await resolve_whatsapp_identity(_contact(phone_number_id, 1))
        [lead] = await _leads([first.chat_id])
        owner = lead.vendedor_id
        assert owner is not None

        # Un segundo mensaje del mismo contacto no consume turno ni cambia dueño.
        again = await resolve_whatsapp_identity(_contact(phone_number_id, 1))
        assert again.chat_id == first.chat_id and not again.lead_created
        [lead] = await _leads([first.chat_id])
        assert lead.vendedor_id == owner

        # El alta manual sin vendedor queda sin vendedor: la decisión es de
        # quien la cargó.
        manual_id = await create_lead("51999112233", "Manual", actor=Actor.user(users["admin"]))
        [manual] = await _leads([manual_id])
        assert manual.vendedor_id is None


@pytest.mark.asyncio
async def test_disabled_setting_leaves_new_leads_unassigned(tenant) -> None:  # noqa: F811
    context, phone_number_id, _ids = tenant
    with tenant_context(context):
        await _seed_users()
        resolved = await resolve_whatsapp_identity(_contact(phone_number_id, 7))
        [lead] = await _leads([resolved.chat_id])
        assert lead.vendedor_id is None

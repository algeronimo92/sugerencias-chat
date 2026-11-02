"""Unidad de trabajo contra un PostgreSQL real: atomicidad y fases de eventos."""

from __future__ import annotations

import secrets
from dataclasses import dataclass
from datetime import datetime, timezone

import pytest
from sqlalchemy import func, select

from app.core import events
from app.core.events import DomainEvent, Phase, subscribe
from app.db.models.catalogs import LeadTag
from app.db.session import get_sessionmaker
from app.db.uow import collect, current_session, session_scope, unit_of_work
from app.tenancy.context import tenant_context
from tests.postgres_fixtures import app_engine, pg_dsn, tenant  # noqa: F401


@dataclass(frozen=True, kw_only=True)
class TagCreated(DomainEvent):
    name: str


@pytest.fixture(autouse=True)
def isolated_registry(monkeypatch):
    monkeypatch.setattr(events, "_handlers", {})


def _tag(name: str) -> LeadTag:
    return LeadTag(name=name, color="#16a34a", is_active=True, created_at=datetime.now(timezone.utc))


async def _count(name: str) -> int:
    async with get_sessionmaker()() as session:
        return await session.scalar(select(func.count(LeadTag.id)).where(LeadTag.name == name))


async def test_everything_inside_commits_together(tenant):
    a, b = f"a-{secrets.token_hex(3)}", f"b-{secrets.token_hex(3)}"
    with tenant_context(tenant):
        async with unit_of_work():
            current_session().add(_tag(a))
            async with session_scope() as session:  # un repositorio migrado
                session.add(_tag(b))
        assert (await _count(a), await _count(b)) == (1, 1)


async def test_an_error_reverts_everything_and_skips_after_commit(tenant):
    name = f"x-{secrets.token_hex(3)}"
    notified = []

    @subscribe(TagCreated, phase=Phase.AFTER_COMMIT)
    async def notify(event):
        notified.append(event.name)

    with tenant_context(tenant):
        with pytest.raises(RuntimeError):
            async with unit_of_work():
                current_session().add(_tag(name))
                collect(TagCreated(name=name))
                await current_session().flush()
                raise RuntimeError("falla del caso de uso")
        assert await _count(name) == 0
    assert notified == []


async def test_nested_units_share_the_outer_transaction(tenant):
    with tenant_context(tenant):
        async with unit_of_work() as outer:
            async with unit_of_work() as inner:
                assert inner is outer
            async with session_scope() as session:
                assert session is outer.session


async def test_session_scope_alone_commits_on_its_own(tenant):
    name = f"solo-{secrets.token_hex(3)}"
    with tenant_context(tenant):
        async with session_scope() as session:
            session.add(_tag(name))
        assert await _count(name) == 1


async def test_transaction_handlers_write_atomically_with_the_use_case(tenant):
    name = f"tx-{secrets.token_hex(3)}"

    @subscribe(TagCreated, phase=Phase.TRANSACTION)
    async def mirror(event):
        current_session().add(_tag(event.name + "-espejo"))

    @subscribe(TagCreated, phase=Phase.TRANSACTION)
    async def veto(event):
        if event.name.startswith("tx-"):
            raise ValueError("vetado")

    with tenant_context(tenant):
        with pytest.raises(ValueError):
            async with unit_of_work():
                current_session().add(_tag(name))
                collect(TagCreated(name=name))
        assert (await _count(name), await _count(name + "-espejo")) == (0, 0)


async def test_after_commit_handlers_see_the_committed_state(tenant):
    name = f"ac-{secrets.token_hex(3)}"
    seen = []

    @subscribe(TagCreated, phase=Phase.AFTER_COMMIT)
    async def read_back(event):
        seen.append(await _count(event.name))

    with tenant_context(tenant):
        async with unit_of_work():
            current_session().add(_tag(name))
            collect(TagCreated(name=name))
    assert seen == [1]


def test_without_a_unit_of_work_there_is_no_current_session():
    with pytest.raises(RuntimeError):
        current_session()
    with pytest.raises(RuntimeError):
        collect(TagCreated(name="x"))

from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from sqlalchemy.dialects import postgresql

from app.modules.leads import assignment
from app.modules.leads.assignment import (
    AUTO_ASSIGN_REASON,
    assign_next_seller,
    parse_excluded_ids,
    pick_next_vendedor_id,
)
from app.modules.leads.domain.lead import Actor
from app.modules.platform.settings_service import normalize_user_ids
from tests.conftest import patch_session_scope


@pytest.mark.asyncio
async def test_pick_next_vendedor_id_returns_query_result(monkeypatch):
    session = AsyncMock()
    session.scalar = AsyncMock(return_value=7)

    _serve(monkeypatch, session)
    result = await pick_next_vendedor_id()

    assert result == 7
    session.scalar.assert_awaited_once()


@pytest.mark.asyncio
async def test_pick_next_vendedor_id_returns_none_without_active_vendedores(monkeypatch):
    session = AsyncMock()
    session.scalar = AsyncMock(return_value=None)

    _serve(monkeypatch, session)
    assert await pick_next_vendedor_id() is None


@pytest.mark.asyncio
async def test_pick_next_vendedor_id_leaves_out_excluded_sellers(monkeypatch):
    session = AsyncMock()
    session.scalar = AsyncMock(return_value=3)

    _serve(monkeypatch, session)
    await pick_next_vendedor_id({9, 4})

    sql = str(session.scalar.await_args.args[0].compile(
        dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True},
    ))
    assert "users.id NOT IN (4, 9)" in sql


def test_parse_excluded_ids_ignores_garbage():
    assert parse_excluded_ids(" 3, 1,,x, 3 ") == frozenset({1, 3})
    assert parse_excluded_ids("") == frozenset()
    assert parse_excluded_ids(None) == frozenset()


def test_settings_store_excluded_ids_in_canonical_form():
    assert normalize_user_ids(" 5, 2,5 ,") == "2,5"
    assert normalize_user_ids("") == ""
    with pytest.raises(ValueError):
        normalize_user_ids("2,ana")


@pytest.mark.asyncio
async def test_assign_next_seller_goes_through_update_lead_as_the_system(monkeypatch):
    executed = []
    _fake_uow(monkeypatch, executed)
    monkeypatch.setattr(assignment, "pick_next_vendedor_id", AsyncMock(return_value=12))
    update = AsyncMock()
    monkeypatch.setattr(assignment, "update_lead", update)

    assert await assign_next_seller("lead-1", excluded={4}) == 12

    assignment.pick_next_vendedor_id.assert_awaited_once_with({4})
    update.assert_awaited_once_with(
        "lead-1", {"vendedor_id": 12},
        actor=Actor.system(), metadata={"motivo": AUTO_ASSIGN_REASON},
    )
    # El lock del reparto se toma antes de elegir: sin él dos altas a la vez
    # eligen al mismo vendedor.
    assert "pg_advisory_xact_lock" in str(executed[0])


@pytest.mark.asyncio
async def test_assign_next_seller_leaves_the_lead_alone_without_sellers(monkeypatch):
    _fake_uow(monkeypatch, [])
    monkeypatch.setattr(assignment, "pick_next_vendedor_id", AsyncMock(return_value=None))
    update = AsyncMock()
    monkeypatch.setattr(assignment, "update_lead", update)

    assert await assign_next_seller("lead-1") is None
    update.assert_not_awaited()


def _fake_uow(monkeypatch, executed):
    async def execute(statement):
        executed.append(statement)

    @asynccontextmanager
    async def unit_of_work():
        yield SimpleNamespace(session=SimpleNamespace(execute=execute))

    monkeypatch.setattr(assignment, "unit_of_work", unit_of_work)


def _serve(monkeypatch, session):
    class Opened:
        async def __aenter__(self):
            return session

        async def __aexit__(self, *_exc):
            return False

    patch_session_scope(monkeypatch, assignment, lambda: Opened)

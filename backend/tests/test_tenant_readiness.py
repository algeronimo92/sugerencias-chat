from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

import main


SCHEMA = "tenant_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"


class _Result:
    def __init__(self, *, scalar=None, rows=None):
        self._scalar = scalar
        self._rows = rows or []

    def scalar(self):
        return self._scalar

    def scalar_one_or_none(self):
        return self._scalar

    def mappings(self):
        return self

    def all(self):
        return self._rows


class _Connection:
    def __init__(self, *, head: str, registered: str | None = None, status="current", actual=None):
        self.head = head
        self.registered = registered if registered is not None else head
        self.status = status
        self.actual = actual if actual is not None else head
        self.dialect = SimpleNamespace(
            identifier_preparer=SimpleNamespace(quote=lambda name: f'"{name}"')
        )

    async def execute(self, statement):
        sql = str(statement)
        if "FROM public.organizations" in sql:
            return _Result(
                rows=[
                    {
                        "id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                        "schema_name": SCHEMA,
                        "revision": self.registered,
                        "migration_status": self.status,
                    }
                ]
            )
        if f'FROM "{SCHEMA}".alembic_version' in sql:
            return _Result(scalar=self.actual)
        return _Result(scalar=self.head)


class _ConnectionContext:
    def __init__(self, connection):
        self.connection = connection

    async def __aenter__(self):
        return self.connection

    async def __aexit__(self, exc_type, exc, tb):
        return False


class _Engine:
    def __init__(self, connection):
        self.connection = connection

    def connect(self):
        return _ConnectionContext(self.connection)


@pytest.mark.asyncio
async def test_active_tenant_readiness_checks_registry_and_real_schema(monkeypatch) -> None:
    monkeypatch.setattr(main, "get_engine", lambda: _Engine(_Connection(head="head")))
    await main._verify_active_tenant_schemas("head")


@pytest.mark.asyncio
async def test_active_tenant_readiness_rejects_registry_drift(monkeypatch) -> None:
    connection = _Connection(head="head", registered="old")
    monkeypatch.setattr(main, "get_engine", lambda: _Engine(connection))
    with pytest.raises(main.SchemaNotMigratedError, match="no está marcado"):
        await main._verify_active_tenant_schemas("head")


@pytest.mark.asyncio
async def test_active_tenant_readiness_rejects_real_schema_drift(monkeypatch) -> None:
    connection = _Connection(head="head", actual="old")
    monkeypatch.setattr(main, "get_engine", lambda: _Engine(connection))
    with pytest.raises(main.SchemaNotMigratedError, match="está en old"):
        await main._verify_active_tenant_schemas("head")


@pytest.mark.asyncio
async def test_global_schema_check_invokes_tenants_when_enabled(monkeypatch) -> None:
    monkeypatch.setattr(main, "get_engine", lambda: _Engine(_Connection(head="head")))
    monkeypatch.setattr(main, "_alembic_head", lambda: "head")
    tenant_check = AsyncMock()
    monkeypatch.setattr(main, "_verify_active_tenant_schemas", tenant_check)
    monkeypatch.setattr(main.settings, "multitenancy_enabled", True)

    await main._verify_schema_is_current()

    tenant_check.assert_awaited_once_with("head")

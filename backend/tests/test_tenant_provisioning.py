from __future__ import annotations

import importlib.util
from pathlib import Path
from types import SimpleNamespace
from uuid import UUID

import pytest

import scripts.migrate as migrate_script
import tenancy.provisioning as provisioning
from tenancy.context import TenantContext, get_current_tenant


_D2_PATH = (
    Path(__file__).resolve().parent.parent
    / "alembic"
    / "versions"
    / "d2b7c4e91a60_control_plane_multitenant.py"
)
_D2_SPEC = importlib.util.spec_from_file_location("tenant_control_revision", _D2_PATH)
assert _D2_SPEC is not None and _D2_SPEC.loader is not None
d2 = importlib.util.module_from_spec(_D2_SPEC)
_D2_SPEC.loader.exec_module(d2)


CONTEXT = TenantContext(
    UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
    "tenant_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "a.example.com",
)


def test_alembic_tenant_run_binds_connection_and_schema(monkeypatch) -> None:
    config = SimpleNamespace(attributes={})
    calls = []
    monkeypatch.setattr(provisioning, "_alembic_config", lambda: config)
    monkeypatch.setattr(
        provisioning.command,
        "upgrade",
        lambda received_config, target: calls.append((received_config, target)),
    )
    connection = object()

    provisioning._run_tenant_alembic(connection, CONTEXT.schema_name)

    assert config.attributes == {
        "connection": connection,
        "tenant_schema": CONTEXT.schema_name,
    }
    assert calls == [(config, "head")]


def test_d2_tenant_mode_omits_every_public_control_table(monkeypatch) -> None:
    class Operations:
        def __init__(self):
            self.tables = []
            self.indexes = []

        def create_table(self, name, *args, **kwargs):
            self.tables.append((name, kwargs.get("schema")))

        def create_index(self, name, *args, **kwargs):
            self.indexes.append((name, kwargs.get("schema")))

    operations = Operations()
    monkeypatch.setattr(
        d2, "context", SimpleNamespace(config=SimpleNamespace(attributes={"tenant_schema": CONTEXT.schema_name}))
    )
    monkeypatch.setattr(d2, "op", operations)

    d2.upgrade()

    assert operations.tables == [
        ("ai_jobs", None),
        ("knowledge_documents", None),
        ("knowledge_chunks", None),
    ]
    assert all(schema is None for _, schema in operations.indexes)


@pytest.mark.asyncio
async def test_provision_tenant_runs_migrations_before_activation(monkeypatch) -> None:
    events = []

    async def prepare(**kwargs):
        events.append("prepare")
        return CONTEXT, False

    async def migrate(context):
        assert context == CONTEXT
        events.append("migrate")

    async def activate(context):
        assert context == CONTEXT
        events.append("activate")

    async def initialize(context, **kwargs):
        assert context == CONTEXT
        events.append("initialize")

    monkeypatch.setattr(provisioning, "_prepare_control_records", prepare)
    monkeypatch.setattr(provisioning, "_migrate_schema", migrate)
    monkeypatch.setattr(provisioning, "_mark_active", activate)
    monkeypatch.setattr(provisioning, "_initialize_tenant", initialize)

    result = await provisioning.provision_tenant(name="A", hostname="a.example.com")

    assert result == CONTEXT
    assert events == ["prepare", "migrate", "initialize", "activate"]


@pytest.mark.asyncio
async def test_provision_tenant_is_idempotent_when_current(monkeypatch) -> None:
    async def prepare(**kwargs):
        return CONTEXT, True

    async def should_not_run(context):
        raise AssertionError("current tenant must not be migrated again")

    monkeypatch.setattr(provisioning, "_prepare_control_records", prepare)
    monkeypatch.setattr(provisioning, "_migrate_schema", should_not_run)

    assert await provisioning.provision_tenant(
        name="A", hostname="A.EXAMPLE.COM."
    ) == CONTEXT


@pytest.mark.asyncio
async def test_initializer_uses_validated_settings_service_inside_tenant(monkeypatch) -> None:
    calls = []

    async def settings(values):
        calls.append(("settings", values, get_current_tenant()))

    async def admin(email, password_hash):
        calls.append(("admin", email, password_hash, get_current_tenant()))

    monkeypatch.setattr(provisioning, "update_settings", settings)
    monkeypatch.setattr(provisioning, "seed_admin_if_needed", admin)

    await provisioning._initialize_tenant(
        CONTEXT,
        initial_settings={"default_country_code": "51"},
        admin_email="ADMIN@EXAMPLE.COM",
        admin_password_hash="hash",
    )

    assert calls == [
        ("settings", {"default_country_code": "51"}, CONTEXT),
        ("admin", "admin@example.com", "hash", CONTEXT),
    ]
    assert get_current_tenant() is None


@pytest.mark.asyncio
async def test_suspend_organization_revokes_sessions_and_closes_sockets(monkeypatch) -> None:
    """Suspender no es solo marcar el status: la sesión de un vendedor con
    cookie válida y su WebSocket ya abierto no vuelven a pasar por el
    middleware de host hasta que expiran o se cortan a mano."""
    events = []

    async def mark_suspended(organization_id):
        events.append(("mark_suspended", organization_id))
        return CONTEXT

    async def revoke():
        events.append(("revoke", get_current_tenant()))

    async def disconnect(organization_id):
        events.append(("disconnect", organization_id))

    monkeypatch.setattr(provisioning, "_mark_suspended", mark_suspended)
    monkeypatch.setattr(provisioning, "revoke_all_sessions_in_current_tenant", revoke)
    monkeypatch.setattr(provisioning.ws_manager, "disconnect_organization", disconnect)

    result = await provisioning.suspend_organization(CONTEXT.organization_id)

    assert result == CONTEXT
    assert events == [
        ("mark_suspended", CONTEXT.organization_id),
        ("revoke", CONTEXT),
        ("disconnect", CONTEXT.organization_id),
    ]
    # revoke_all_sessions_in_current_tenant corrió dentro de tenant_context,
    # pero afuera no debe quedar tenant activo para lo que siga.
    assert get_current_tenant() is None


@pytest.mark.asyncio
async def test_migrate_check_detects_registry_or_schema_drift(monkeypatch) -> None:
    async def active(engine):
        return [(CONTEXT, "old", "current")]

    async def actual(engine, context):
        return "head"

    monkeypatch.setattr(migrate_script, "_active_tenants", active)
    monkeypatch.setattr(migrate_script, "_actual_tenant_revision", actual)

    assert await migrate_script._check_tenants(object(), "head") == 1

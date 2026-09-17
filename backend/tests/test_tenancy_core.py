from __future__ import annotations

from contextlib import asynccontextmanager
from uuid import UUID

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import sessionmaker

import db.session as session_module
import tenancy.middleware as middleware_module
from db.models import (
    AIJob,
    KnowledgeChunk,
    KnowledgeDocument,
    Organization,
    OrganizationDomain,
    TenantSchemaVersion,
    WebhookInbox,
    WhatsAppConnection,
)
from db.session import _TenantRoutingSyncSession, control_session, tenant_session
from tenancy.context import (
    TenantContext,
    get_current_tenant,
    reset_current_tenant,
    set_current_tenant,
    tenant_context,
    validate_schema_name,
)
from tenancy.middleware import TenantResolutionMiddleware
from tenancy.resolver import normalize_hostname


ORG_A = UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
ORG_B = UUID("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")
TENANT_A = TenantContext(ORG_A, "tenant_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "a.example.com")
TENANT_B = TenantContext(ORG_B, "tenant_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "b.example.com")


def test_schema_name_is_a_closed_generated_identifier() -> None:
    assert validate_schema_name(TENANT_A.schema_name) == TENANT_A.schema_name
    for invalid in ("public", "tenant_a", "tenant_" + "a" * 31, 'tenant_' + 'a' * 31 + '"'):
        with pytest.raises(ValueError):
            validate_schema_name(invalid)


def test_tenant_context_is_nested_and_restored() -> None:
    assert get_current_tenant() is None
    with tenant_context(TENANT_A):
        assert get_current_tenant() == TENANT_A
        with tenant_context(TENANT_B):
            assert get_current_tenant() == TENANT_B
        assert get_current_tenant() == TENANT_A
    assert get_current_tenant() is None


def test_hostname_normalization_rejects_ambiguous_and_ip_hosts() -> None:
    assert normalize_hostname("NEGOCIO.Example.com.:443") == "negocio.example.com"
    for invalid in (None, "", "127.0.0.1", "[::1]", "a.example.com,evil.test", "a/b"):
        with pytest.raises(ValueError):
            normalize_hostname(invalid)


def test_existing_session_pattern_applies_each_current_tenant_on_begin() -> None:
    """Ejercita una Session real con el patrón existente sessionmaker()()."""

    applied_paths: list[str] = []
    engine = create_engine("sqlite://")

    @event.listens_for(engine, "connect")
    def register_set_config(dbapi_connection, connection_record) -> None:
        dbapi_connection.create_function(
            "set_config",
            3,
            lambda key, value, local: applied_paths.append(value) or value,
        )

    factory = sessionmaker(bind=engine, class_=_TenantRoutingSyncSession)
    for context in (TENANT_A, TENANT_B):
        token = set_current_tenant(context)
        try:
            with factory() as db:
                assert db.execute(text("SELECT 1")).scalar_one() == 1
                db.commit()
        finally:
            reset_current_tenant(token)

    # Sin contexto no se reutiliza el tenant anterior. PostgreSQL además
    # revierte set_config(..., true) al cerrar cada transacción.
    with factory() as db:
        assert db.execute(text("SELECT 1")).scalar_one() == 1

    assert applied_paths == [
        "tenant_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa, public",
        "tenant_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb, public",
    ]
    engine.dispose()


class _Begin:
    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False


class _FakeAsyncSession:
    def __init__(self) -> None:
        self.executions: list[tuple[str, dict]] = []
        self.closed = False

    def begin(self):
        return _Begin()

    async def execute(self, statement, params):
        self.executions.append((str(statement), params))

    async def close(self):
        self.closed = True


@pytest.mark.asyncio
async def test_explicit_factories_force_tenant_and_control_paths(monkeypatch) -> None:
    sessions: list[_FakeAsyncSession] = []

    def factory():
        session = _FakeAsyncSession()
        sessions.append(session)
        return session

    monkeypatch.setattr(session_module, "get_sessionmaker", lambda: factory)

    async with tenant_session(TENANT_A):
        pass
    token = set_current_tenant(TENANT_A)
    try:
        async with control_session():
            pass
    finally:
        reset_current_tenant(token)

    assert sessions[0].executions[0][1] == {
        "search_path": "tenant_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa, public"
    }
    assert sessions[1].executions[0][1] == {"search_path": "public"}
    assert all(session.closed for session in sessions)


def _test_app() -> FastAPI:
    app = FastAPI()

    @app.get("/private")
    async def private(request: Request):
        context = get_current_tenant()
        return {
            "organization_id": str(context.organization_id) if context else None,
            "request_state": str(request.state.tenant_context.organization_id),
        }

    @app.get("/health")
    async def health():
        return {"ok": True}

    app.add_middleware(
        TenantResolutionMiddleware,
        enabled=True,
        platform_hosts=("platform.example.com",),
    )
    return app


def test_middleware_resolves_exact_host_and_fails_closed(monkeypatch) -> None:
    async def resolve(hostname: str):
        return TENANT_A if hostname == TENANT_A.hostname else None

    monkeypatch.setattr(middleware_module, "resolve_tenant_by_hostname", resolve)
    client = TestClient(_test_app())

    accepted = client.get("/private", headers={"host": TENANT_A.hostname})
    assert accepted.status_code == 200
    assert accepted.json()["organization_id"] == str(ORG_A)
    assert get_current_tenant() is None

    assert client.get("/private", headers={"host": "unknown.example.com"}).status_code == 404
    assert client.get("/private", headers={"host": "127.0.0.1"}).status_code == 400
    assert client.get("/health", headers={"host": "unknown.example.com"}).status_code == 200


def test_control_and_tenant_models_declare_the_correct_schema() -> None:
    for model in (
        Organization,
        OrganizationDomain,
        WhatsAppConnection,
        TenantSchemaVersion,
        WebhookInbox,
    ):
        assert model.__table__.schema == "public"
    assert AIJob.__table__.schema is None
    assert AIJob.__table__.c.context_revision.type.python_type is str
    assert KnowledgeDocument.__table__.schema is None
    assert KnowledgeChunk.__table__.schema is None

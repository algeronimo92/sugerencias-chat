"""Fixtures compartidos para los tests contra un PostgreSQL real.

Reutilizan la resolución de credenciales de ``test_tenant_postgres_integration``
(``TEST_DATABASE_URL`` o ``db/.env``) y se saltan si no hay base accesible,
salvo que ``TEST_DATABASE_URL`` esté definida: ahí fallan, para que el CI no
pase en verde sin haberlos corrido.
"""

from __future__ import annotations

import secrets

import pytest_asyncio
from sqlalchemy import text

from app.core.config import settings
from app.db.session import close_engine, control_session, get_engine
from app.tenancy.context import validate_schema_name
from app.tenancy.provisioning import provision_tenant
from tests.test_tenant_postgres_integration import pg_dsn  # noqa: F401


@pytest_asyncio.fixture
async def app_engine(pg_dsn, monkeypatch):  # noqa: F811
    """Engine contra el Postgres real con un pool como el de producción.

    El de ``test_tenant_postgres_integration`` fija una sola conexión para
    probar el aislamiento; acá eso bloquearía los casos de uso que todavía
    abren una sesión dentro de otra.
    """
    monkeypatch.setattr(settings, "database_url", pg_dsn)
    monkeypatch.setattr(settings, "database_ssl", "disable")
    monkeypatch.setattr(settings, "database_pool_size", 5)
    monkeypatch.setattr(settings, "database_max_overflow", 5)
    await close_engine()
    engine = get_engine()
    try:
        yield engine
    finally:
        await close_engine()


@pytest_asyncio.fixture
async def tenant(app_engine):
    """Un negocio recién aprovisionado (recorre todas las migraciones)."""
    suffix = secrets.token_hex(4)
    context = await provision_tenant(
        name=f"Test {suffix}",
        hostname=f"test-{suffix}.integration.test",
    )
    try:
        yield context
    finally:
        async with control_session() as session:
            await session.execute(
                text("DELETE FROM public.organizations WHERE id = :id"),
                {"id": str(context.organization_id)},
            )
        async with app_engine.begin() as connection:
            schema = validate_schema_name(context.schema_name)
            await connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))

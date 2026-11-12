"""e5c1a8f37b42 deja ``public`` como en producción, sin tablas del negocio,
solo cuando es seguro: hay un negocio con su schema y nadie opera el negocio
en ``public``. En una base recién creada (CI) no toca nada."""

from __future__ import annotations

import secrets

from alembic import command
from sqlalchemy import text

import scripts.migrate as migrate_script
from tests.postgres_fixtures import pg_dsn  # noqa: F401
from tests.test_public_plane_migrations_postgres import PUBLIC_TABLES, scratch_database  # noqa: F401

CLEANUP = "e5c1a8f37b42"
BEFORE_CLEANUP = "a7e3c5d91b20"


def _upgrade_to(connection, revision: str) -> None:
    config = migrate_script._alembic_config()
    config.attributes["connection"] = connection
    command.upgrade(config, revision)


def _public_tables(connection) -> set[str]:
    return set(connection.execute(
        text("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")
    ).scalars())


def _register_tenant(connection) -> None:
    schema = f"tenant_{secrets.token_hex(16)}"
    connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    connection.execute(
        text("INSERT INTO public.organizations (name, schema_name, status) VALUES ('Negocio', :schema, 'active')"),
        {"schema": schema},
    )


async def _public_after_cleanup(database, prepare=None) -> set[str]:
    async with database.begin() as connection:
        await connection.run_sync(_upgrade_to, BEFORE_CLEANUP)
        if prepare is not None:
            await connection.run_sync(prepare)
    async with database.begin() as connection:
        await connection.run_sync(_upgrade_to, CLEANUP)
        return await connection.run_sync(_public_tables)


async def test_a_new_database_keeps_its_business_tables_in_public(scratch_database) -> None:  # noqa: F811
    # Sin ningún negocio con schema propio, public es el único lugar del
    # negocio: la suite de CI corre ahí.
    assert {"users", "leads"} <= await _public_after_cleanup(scratch_database)


async def test_with_a_tenant_public_keeps_only_the_control_plane(scratch_database) -> None:  # noqa: F811
    tables = await _public_after_cleanup(scratch_database, _register_tenant)

    assert tables == set(PUBLIC_TABLES) & tables
    assert {"organizations", "platform_users", "auth_login_throttles", "alembic_version"} <= tables
    assert "users" not in tables and "leads" not in tables


async def test_business_activity_in_public_is_never_dropped(scratch_database) -> None:  # noqa: F811
    def tenant_and_a_user_in_public(connection) -> None:
        _register_tenant(connection)
        connection.execute(text(
            "INSERT INTO public.users (email, name, password_hash, role, is_active, created_at) "
            "VALUES ('ana@example.com', 'Ana', 'x', 'admin', true, now())"
        ))

    tables = await _public_after_cleanup(scratch_database, tenant_and_a_user_in_public)

    assert {"users", "leads"} <= tables

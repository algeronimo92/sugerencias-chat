"""PostgreSQL rechaza por sí mismo lo que el rol de base no puede hacer.

Corre contra el Postgres de Docker (ver ``pg_dsn``) en un schema descartable
con unas pocas tablas del negocio. Los roles ``cv_*`` son del cluster: quedan
creados, igual que los deja ``scripts.migrate``.
"""

from __future__ import annotations

import secrets

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.db import privileges as db
from app.modules.auth.db_privileges import object_privileges_for
from app.modules.auth.permissions import DEFAULT_ROLE_PERMISSIONS
from tests.test_tenant_postgres_integration import pg_dsn  # noqa: F401


@pytest.fixture
async def schema(pg_dsn):
    engine = create_async_engine(pg_dsn, connect_args={"ssl": "disable"})
    name = f"tenant_{secrets.token_hex(16)}"
    async with engine.begin() as connection:
        if not await db.ensure_db_roles(connection):
            pytest.skip("el usuario de la base local no puede crear roles")
        await connection.execute(text(f'CREATE SCHEMA "{name}"'))
        await connection.execute(text(f'CREATE TABLE "{name}".leads (id serial PRIMARY KEY, nombre text)'))
        await connection.execute(text(
            f'CREATE TABLE "{name}".users (id serial PRIMARY KEY, name text, password_hash text)'
        ))
        await connection.execute(text(f'CREATE TABLE "{name}".data_exports (id serial PRIMARY KEY, report text)'))
        await connection.execute(text(f'INSERT INTO "{name}".leads (nombre) VALUES (\'Ana\')'))
        await connection.execute(text(f'INSERT INTO "{name}".users (name, password_hash) VALUES (\'Bea\', \'x\')'))
    async with AsyncSession(engine) as session, session.begin():
        await db.apply_schema_grants(session, name, {
            "cv_admin": object_privileges_for("admin", frozenset()),
            "cv_vendedor": object_privileges_for("vendedor", DEFAULT_ROLE_PERMISSIONS["vendedor"]),
            "cv_analista": object_privileges_for("analista", DEFAULT_ROLE_PERMISSIONS["analista"]),
        })
    yield engine, name
    async with engine.begin() as connection:
        await connection.execute(text(f'DROP SCHEMA "{name}" CASCADE'))
    await engine.dispose()


async def _as(engine, schema: str, role: str, sql: str) -> None:
    async with engine.begin() as connection:
        await connection.execute(text(f"SET LOCAL search_path = \"{schema}\""))
        await connection.execute(text(f'SET LOCAL ROLE "{role}"'))
        await connection.execute(text(sql))


async def _denied(engine, schema: str, role: str, sql: str) -> None:
    with pytest.raises(DBAPIError) as raised:
        await _as(engine, schema, role, sql)
    # "permission denied" para DML y "must be owner" para DDL: el mismo código 42501.
    assert "InsufficientPrivilegeError" in str(raised.value)


async def test_the_analyst_reads_but_cannot_change_business_data(schema):
    engine, name = schema
    await _as(engine, name, "cv_analista", "SELECT * FROM leads")
    await _as(engine, name, "cv_analista", "INSERT INTO data_exports (report) VALUES ('ventas')")
    await _denied(engine, name, "cv_analista", "UPDATE leads SET nombre = 'otra'")
    await _denied(engine, name, "cv_analista", "DELETE FROM leads")
    await _denied(engine, name, "cv_analista", "INSERT INTO leads (nombre) VALUES ('x')")


async def test_the_seller_edits_leads_but_cannot_delete_them(schema):
    engine, name = schema
    await _as(engine, name, "cv_vendedor", "INSERT INTO leads (nombre) VALUES ('nuevo')")
    await _as(engine, name, "cv_vendedor", "UPDATE leads SET nombre = 'otra'")
    await _denied(engine, name, "cv_vendedor", "DELETE FROM leads")
    await _as(engine, name, "cv_admin", "DELETE FROM leads")


async def test_only_the_password_column_of_users_can_be_updated_without_users_manage(schema):
    engine, name = schema
    await _as(engine, name, "cv_vendedor", "UPDATE users SET password_hash = 'y'")
    await _denied(engine, name, "cv_vendedor", "UPDATE users SET name = 'Admin'")
    await _as(engine, name, "cv_admin", "UPDATE users SET name = 'Admin'")


@pytest.mark.parametrize("role", ["cv_admin", "cv_vendedor", "cv_analista"])
async def test_no_role_has_system_privileges_over_the_schema(schema, role):
    engine, name = schema
    await _denied(engine, name, role, "CREATE TABLE intrusa (id int)")
    await _denied(engine, name, role, "DROP TABLE leads")
    await _denied(engine, name, role, "ALTER TABLE leads ADD COLUMN x int")


async def test_reapplying_the_grants_revokes_what_the_matrix_no_longer_gives(schema):
    engine, name = schema
    async with AsyncSession(engine) as session, session.begin():
        await db.apply_schema_grants(session, name, {"cv_vendedor": {"leads": frozenset({"SELECT"})}})
    await _as(engine, name, "cv_vendedor", "SELECT * FROM leads")
    await _denied(engine, name, "cv_vendedor", "UPDATE leads SET nombre = 'otra'")
    # El privilegio de columna también se fue.
    await _denied(engine, name, "cv_vendedor", "UPDATE users SET password_hash = 'z'")


async def test_postgres_reports_what_is_applied(schema):
    engine, name = schema
    async with AsyncSession(engine) as session, session.begin():
        described = {row["db_role"]: row for row in await db.describe_privileges(session, name)}
    analyst = described["cv_analista"]
    assert analyst["system"] == {
        "superuser": False, "create_db": False, "create_role": False, "login": False,
        "bypass_rls": False, "schema_usage": True, "schema_create": False,
    }
    objects = {item["object"]: item["privileges"] for item in analyst["objects"]}
    assert objects["leads"] == ["SELECT"]
    assert objects["users"] == ["SELECT"]
    assert objects["users.password_hash"] == ["UPDATE"]

"""PostgreSQL rechaza por sí mismo lo que el rol de base no puede hacer.

Corre contra el Postgres de Docker (ver ``pg_dsn``) en dos schemas de negocio
descartables con unas pocas tablas. Al terminar borra los schemas y los
roles ``cv_<id>_*`` que creó.
"""

from __future__ import annotations

import secrets

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

from app.db import privileges as db
from app.modules.auth.db_privileges import object_privileges_for
from app.modules.auth.permissions import DEFAULT_ROLE_PERMISSIONS
from tests.test_tenant_postgres_integration import pg_dsn  # noqa: F401

DEFAULT_GRANTS = {
    "admin": object_privileges_for("admin", frozenset()),
    "vendedor": object_privileges_for("vendedor", DEFAULT_ROLE_PERMISSIONS["vendedor"]),
    "analista": object_privileges_for("analista", DEFAULT_ROLE_PERMISSIONS["analista"]),
}


async def _create_business(engine, name: str) -> None:
    async with engine.begin() as connection:
        await connection.execute(text(f'CREATE SCHEMA "{name}"'))
        await connection.execute(text(f'CREATE TABLE "{name}".leads (id serial PRIMARY KEY, nombre text)'))
        await connection.execute(text(
            f'CREATE TABLE "{name}".users (id serial PRIMARY KEY, name text, password_hash text)'
        ))
        await connection.execute(text(f'CREATE TABLE "{name}".data_exports (id serial PRIMARY KEY, report text)'))
        await connection.execute(text(f'INSERT INTO "{name}".leads (nombre) VALUES (\'Ana\')'))
        await connection.execute(text(f'INSERT INTO "{name}".users (name, password_hash) VALUES (\'Bea\', \'x\')'))
    async with AsyncSession(engine) as session, session.begin():
        if not await db.apply_schema_grants(session, name, DEFAULT_GRANTS):
            pytest.skip("el usuario de la base local no puede crear roles")


@pytest.fixture
async def businesses(pg_dsn):
    engine = create_async_engine(pg_dsn, connect_args={"ssl": "disable"})
    names = [f"tenant_{secrets.token_hex(16)}", f"tenant_{secrets.token_hex(16)}"]
    try:
        for name in names:
            await _create_business(engine, name)
        yield engine, names
    finally:
        async with engine.begin() as connection:
            for name in names:
                await connection.execute(text(f'DROP SCHEMA IF EXISTS "{name}" CASCADE'))
                for role in db.all_tenant_roles(name):
                    exists = (await connection.execute(
                        text("SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :r)"), {"r": role},
                    )).scalar_one()
                    if exists:
                        await connection.execute(text(f'DROP OWNED BY "{role}"'))
                        await connection.execute(text(f'DROP ROLE "{role}"'))
        await engine.dispose()


@pytest.fixture
def schema(businesses):
    engine, names = businesses
    return engine, names[0]


async def _as(engine, schema: str, role: str, sql: str) -> None:
    async with engine.begin() as connection:
        await connection.execute(text(f'SET LOCAL search_path = "{schema}"'))
        await connection.execute(text(f'SET LOCAL ROLE "{db.tenant_db_role(schema, role)}"'))
        await connection.execute(text(sql))


async def _denied(engine, schema: str, role: str, sql: str) -> None:
    with pytest.raises(DBAPIError) as raised:
        await _as(engine, schema, role, sql)
    # "permission denied" para DML y "must be owner" para DDL: el mismo código 42501.
    assert "InsufficientPrivilegeError" in str(raised.value)


async def test_the_analyst_reads_but_cannot_change_business_data(schema):
    engine, name = schema
    await _as(engine, name, "analista", "SELECT * FROM leads")
    await _as(engine, name, "analista", "INSERT INTO data_exports (report) VALUES ('ventas')")
    await _denied(engine, name, "analista", "UPDATE leads SET nombre = 'otra'")
    await _denied(engine, name, "analista", "DELETE FROM leads")
    await _denied(engine, name, "analista", "INSERT INTO leads (nombre) VALUES ('x')")


async def test_the_seller_edits_leads_but_cannot_delete_them(schema):
    engine, name = schema
    await _as(engine, name, "vendedor", "INSERT INTO leads (nombre) VALUES ('nuevo')")
    await _as(engine, name, "vendedor", "UPDATE leads SET nombre = 'otra'")
    await _denied(engine, name, "vendedor", "DELETE FROM leads")
    await _as(engine, name, "admin", "DELETE FROM leads")


async def test_only_the_password_column_of_users_can_be_updated_without_users_manage(schema):
    engine, name = schema
    await _as(engine, name, "vendedor", "UPDATE users SET password_hash = 'y'")
    await _denied(engine, name, "vendedor", "UPDATE users SET name = 'Admin'")
    await _as(engine, name, "admin", "UPDATE users SET name = 'Admin'")


@pytest.mark.parametrize("role", ["admin", "vendedor", "analista"])
async def test_no_role_has_system_privileges_over_the_schema(schema, role):
    engine, name = schema
    await _denied(engine, name, role, "CREATE TABLE intrusa (id int)")
    await _denied(engine, name, role, "DROP TABLE leads")
    await _denied(engine, name, role, "ALTER TABLE leads ADD COLUMN x int")


@pytest.mark.parametrize("role", ["admin", "vendedor", "analista"])
async def test_a_business_cannot_reach_the_tables_of_another(businesses, role):
    """Aunque el search_path apunte al otro negocio, la base lo rechaza: el
    rol solo tiene privilegios en su propio schema."""
    engine, (own, other) = businesses

    async def as_own_role_in(schema: str, sql: str) -> None:
        async with engine.begin() as connection:
            await connection.execute(text(f'SET LOCAL search_path = "{schema}"'))
            await connection.execute(text(f'SET LOCAL ROLE "{db.tenant_db_role(own, role)}"'))
            await connection.execute(text(sql))

    await as_own_role_in(own, "SELECT * FROM leads")
    for sql in (f'SELECT * FROM "{other}".leads', f'UPDATE "{other}".users SET password_hash = \'z\''):
        with pytest.raises(DBAPIError) as raised:
            await as_own_role_in(own, sql)
        assert "InsufficientPrivilegeError" in str(raised.value)
    with pytest.raises(DBAPIError):
        await as_own_role_in(other, "SELECT * FROM leads")


async def test_reapplying_the_grants_revokes_what_the_matrix_no_longer_gives(schema):
    engine, name = schema
    async with AsyncSession(engine) as session, session.begin():
        await db.apply_schema_grants(session, name, {"vendedor": {"leads": frozenset({"SELECT"})}})
    await _as(engine, name, "vendedor", "SELECT * FROM leads")
    await _denied(engine, name, "vendedor", "UPDATE leads SET nombre = 'otra'")
    # El privilegio de columna también se fue.
    await _denied(engine, name, "vendedor", "UPDATE users SET password_hash = 'z'")


async def test_postgres_reports_what_is_applied(schema):
    engine, name = schema
    async with AsyncSession(engine) as session, session.begin():
        described = {row["db_role"]: row for row in await db.describe_privileges(session, name)}
    assert set(described) == set(db.all_tenant_roles(name))
    analyst = described[db.tenant_db_role(name, "analista")]
    assert analyst["system"] == {
        "superuser": False, "create_db": False, "create_role": False, "login": False,
        "bypass_rls": False, "schema_usage": True, "schema_create": False,
    }
    objects = {item["object"]: item["privileges"] for item in analyst["objects"]}
    assert objects["leads"] == ["SELECT"]
    assert objects["users"] == ["SELECT"]
    assert objects["users.password_hash"] == ["UPDATE"]


async def test_it_tells_whether_the_connection_can_create_the_roles(schema):
    """Producción no tenía CREATEROLE y la pantalla decía "corre las
    migraciones", que ya habían corrido. Se pregunta por el usuario de la
    sesión: con SET ROLE activo, current_user sería el rol del negocio."""
    engine, name = schema
    async with AsyncSession(engine) as session, session.begin():
        assert await db.can_create_roles(session) is True
        await session.execute(text(f'SET LOCAL ROLE "{db.tenant_db_role(name, "admin")}"'))
        assert await db.can_create_roles(session) is True
    async with AsyncSession(engine) as session, session.begin():
        await session.execute(text(f'SET SESSION AUTHORIZATION "{db.tenant_db_role(name, "vendedor")}"'))
        try:
            assert await db.can_create_roles(session) is False
        finally:
            await session.execute(text("RESET SESSION AUTHORIZATION"))


async def test_the_business_role_owns_the_data_of_its_schema_and_nothing_else(businesses):
    """El login del negocio (p. ej. dermicapro) es miembro de este rol: todo el
    DML de su schema, nada de DDL y nada de otro negocio."""
    engine, (own, other) = businesses

    async def as_business(sql: str) -> None:
        async with engine.begin() as connection:
            await connection.execute(text(f'SET LOCAL search_path = "{own}"'))
            await connection.execute(text(f'SET LOCAL ROLE "{db.tenant_business_role(own)}"'))
            await connection.execute(text(sql))

    await as_business("INSERT INTO leads (nombre) VALUES ('nuevo')")
    await as_business("UPDATE users SET name = 'Otra'")
    await as_business("DELETE FROM leads")
    await as_business("TRUNCATE data_exports")
    for sql in ("CREATE TABLE intrusa (id int)", "ALTER TABLE leads ADD COLUMN x int", f'SELECT * FROM "{other}".leads'):
        with pytest.raises(DBAPIError) as raised:
            await as_business(sql)
        assert "InsufficientPrivilegeError" in str(raised.value)


async def test_a_createrole_owner_that_is_not_superuser_can_set_the_roles_it_creates(pg_dsn):
    """Producción: la app se conecta con un dueño con CREATEROLE, no con un
    superusuario. Quien crea un rol así queda miembro con ADMIN pero sin SET;
    si no se pide SET aparte, SET LOCAL ROLE falla el día que se encienda la
    barrera."""
    engine = create_async_engine(pg_dsn, connect_args={"ssl": "disable"}, poolclass=NullPool)
    owner = f"cv_test_owner_{secrets.token_hex(4)}"
    name = f"tenant_{secrets.token_hex(16)}"
    try:
        async with engine.begin() as connection:
            await connection.execute(text(f'CREATE ROLE "{owner}" LOGIN CREATEROLE'))
            await connection.execute(text(f'CREATE SCHEMA "{name}" AUTHORIZATION "{owner}"'))
            await connection.execute(text(f'SET LOCAL ROLE "{owner}"'))
            await connection.execute(text(f'CREATE TABLE "{name}".leads (id serial PRIMARY KEY, nombre text)'))
            await connection.execute(text(f'CREATE TABLE "{name}".users (id serial PRIMARY KEY, name text, password_hash text)'))
            await connection.execute(text(f'CREATE TABLE "{name}".data_exports (id serial PRIMARY KEY, report text)'))
        async with engine.connect() as connection:
            await connection.execute(text(f'SET SESSION AUTHORIZATION "{owner}"'))
            async with AsyncSession(bind=connection) as session:
                assert await db.can_create_roles(session) is True
                assert await db.apply_schema_grants(session, name, DEFAULT_GRANTS) is True
                # El creador del rol dueño figura como miembro (ADMIN), pero no
                # es el login del negocio: en producción salía cliniventas_app.
                assert await db.find_business_login(session, name) is None
                await session.commit()
            await connection.execute(text(f'SET ROLE "{db.tenant_db_role(name, "vendedor")}"'))
            await connection.execute(text(f'UPDATE "{name}".leads SET nombre = nombre'))
            with pytest.raises(DBAPIError):
                await connection.execute(text(f'DELETE FROM "{name}".leads'))
            await connection.rollback()
    finally:
        async with engine.begin() as connection:
            await connection.execute(text(f'DROP SCHEMA IF EXISTS "{name}" CASCADE'))
            for role in [*db.all_tenant_roles(name), owner]:
                exists = (await connection.execute(
                    text("SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :r)"), {"r": role},
                )).scalar_one()
                if exists:
                    await connection.execute(text(f'DROP OWNED BY "{role}"'))
                    await connection.execute(text(f'DROP ROLE "{role}"'))
        await engine.dispose()


async def test_the_business_login_signs_in_with_its_password_and_sees_only_its_schema(businesses, pg_dsn):
    """El login propio del negocio: la contraseña se manda como verificador
    SCRAM, así que iniciar sesión con ella prueba que se armó bien."""
    import asyncpg
    from urllib.parse import urlsplit

    engine, (own, other) = businesses
    login = f"negocio_{secrets.token_hex(4)}"
    password = secrets.token_urlsafe(24)
    async with AsyncSession(engine) as session, session.begin():
        await db.set_business_login(session, own, login, password)
        assert await db.find_business_login(session, own) == login
        # Volver a pedirlo con otra contraseña la reemplaza (no duplica el login).
        password = secrets.token_urlsafe(24)
        await db.set_business_login(session, own, login, password)
    try:
        url = urlsplit(pg_dsn.replace("postgresql+asyncpg", "postgresql"))
        connection = await asyncpg.connect(
            host=url.hostname, port=url.port, database=url.path.lstrip("/"),
            user=login, password=password, ssl=False,
        )
        try:
            await connection.execute(f'INSERT INTO "{own}".leads (nombre) VALUES ($1)', "desde el login")
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await connection.fetch(f'SELECT * FROM "{other}".leads')
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await connection.execute(f'CREATE TABLE "{own}".intrusa (id int)')
        finally:
            await connection.close()
    finally:
        async with engine.begin() as connection:
            await connection.execute(text(f'DROP OWNED BY "{login}"'))
            await connection.execute(text(f'DROP ROLE "{login}"'))


async def test_a_login_of_another_business_is_never_adopted(businesses):
    engine, (own, other) = businesses
    login = f"negocio_{secrets.token_hex(4)}"
    async with AsyncSession(engine) as session, session.begin():
        await db.set_business_login(session, other, login, "una-clave-cualquiera")
    try:
        with pytest.raises(db.BusinessLoginError):
            async with AsyncSession(engine) as session, session.begin():
                await db.set_business_login(session, own, login, "otra-clave")
    finally:
        async with engine.begin() as connection:
            await connection.execute(text(f'DROP OWNED BY "{login}"'))
            await connection.execute(text(f'DROP ROLE "{login}"'))

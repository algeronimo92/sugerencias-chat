"""La cadena de migraciones sobre un ``public`` como el de producción.

``scripts.migrate`` corre cada revisión primero en ``public`` y después en el
schema de cada negocio. En producción ``public`` ya no tiene las tablas del
negocio (``scripts.move_public_to_tenant`` las llevó al schema del tenant):
solo queda el plano de control. En desarrollo y en el job ``migrations-check``
la base nace vacía, la baseline crea todo en ``public`` y cualquier
``op.add_column("users", ...)`` pasa. Por eso el deploy se detuvo cuatro veces
con la misma causa sin que CI avisara:

- 2026-11-05 ``b5e1d7c3a920``: 'relation "users" does not exist'
- 2026-11-08 ``c3f8a2d6e417``: 'relation "knowledge_chunks" does not exist'
- 2026-11-10 ``b3e7a9c1d5f2``: 'relation "users" does not exist'
- 2026-11-12 ``a7e3c5d91b20``: 'relation "users" does not exist'

Cada arreglo cubrió su revisión; este test cubre las que vengan. Arma una base
aparte con la forma de producción y corre desde ahí el mismo camino que el
deploy, así que una revisión nueva que toque una tabla del negocio sin
comprobar antes que existe en el schema activo falla acá y no en el servidor.
"""

from __future__ import annotations

import secrets

import pytest_asyncio
from alembic import command
from alembic.script import ScriptDirectory
from sqlalchemy import make_url, text
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

import scripts.migrate as migrate_script
from app.core.config import settings
from scripts.move_public_to_tenant import CONTROL_PLANE_TABLES, SHARED_TABLES
from tests.postgres_fixtures import pg_dsn  # noqa: F401

# Revisión en la que estaba ``public`` en producción el 2026-11-12, leída de
# ``public.alembic_version``. Hasta acá la base se arma con todas las tablas
# en ``public`` (así nació producción); lo posterior tiene que sobrevivir a un
# ``public`` sin negocio. No hace falta moverla con cada revisión nueva: todo
# lo que quede después de este punto se prueba solo.
PUBLIC_CUTOVER_REVISION = "c4d8e2f61a93"

# Lo que ``move_public_to_tenant`` deja en ``public``. Coincide con las tablas
# que tenía ``public`` en producción el 2026-11-12.
PUBLIC_TABLES = CONTROL_PLANE_TABLES | SHARED_TABLES


@pytest_asyncio.fixture
async def scratch_database(pg_dsn, monkeypatch):  # noqa: F811
    """Una base vacía y propia: el test deja ``public`` sin tablas del negocio
    y no puede hacerlo en la base que comparte el resto de la suite."""
    name = f"public_plane_{secrets.token_hex(4)}"
    admin = create_async_engine(
        pg_dsn, isolation_level="AUTOCOMMIT", poolclass=NullPool,
        connect_args={"ssl": "disable"},
    )
    async with admin.connect() as connection:
        await connection.execute(text(f'CREATE DATABASE "{name}"'))
    url = make_url(pg_dsn).set(database=name).render_as_string(hide_password=False)
    # alembic/env.py mira settings.database_url para negarse a escribir en un
    # host remoto: que vea la base que de verdad se está migrando.
    monkeypatch.setattr(settings, "database_url", url)
    monkeypatch.setattr(settings, "database_ssl", "disable")
    engine = create_async_engine(url, poolclass=NullPool, connect_args={"ssl": "disable"})
    try:
        yield engine
    finally:
        await engine.dispose()
        async with admin.connect() as connection:
            await connection.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        await admin.dispose()


def _upgrade_to(connection, revision: str) -> None:
    config = migrate_script._alembic_config()
    config.attributes["connection"] = connection
    command.upgrade(config, revision)


def _leave_only_the_control_plane(connection) -> list[str]:
    """Quita de ``public`` lo que en producción vive en el schema del negocio."""
    tables = connection.execute(
        text("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")
    ).scalars().all()
    business = sorted(set(tables) - PUBLIC_TABLES)
    preparer = connection.dialect.identifier_preparer
    for table in business:
        connection.execute(text(f"DROP TABLE public.{preparer.quote(table)} CASCADE"))
    return business


def _latest_revision_round_trip(connection) -> None:
    config = migrate_script._alembic_config()
    config.attributes["connection"] = connection
    command.downgrade(config, "-1")
    command.upgrade(config, "head")


async def test_the_chain_runs_on_a_public_schema_without_business_tables(
    scratch_database,
) -> None:
    config = migrate_script._alembic_config()
    head = ScriptDirectory.from_config(config).get_current_head()

    async with scratch_database.begin() as connection:
        await connection.run_sync(_upgrade_to, PUBLIC_CUTOVER_REVISION)
        dropped = await connection.run_sync(_leave_only_the_control_plane)
    # Si esto deja de cumplirse el test ya no reproduce producción y pasaría
    # en verde sin probar nada.
    assert {"users", "leads", "lead_stages"} <= set(dropped)

    # El mismo paso que da el deploy sobre ``public`` (scripts/migrate.py).
    async with scratch_database.begin() as connection:
        assert await connection.run_sync(migrate_script._run, config, False) == 0
        assert await connection.run_sync(migrate_script._current_revision) == head

    # Lo que CI exige de la última revisión en una base completa
    # ("Latest revision downgrades and upgrades again"), en la forma de
    # producción: volver atrás un deploy tampoco puede tropezar con ``public``.
    async with scratch_database.begin() as connection:
        await connection.run_sync(_latest_revision_round_trip)
        assert await connection.run_sync(migrate_script._current_revision) == head

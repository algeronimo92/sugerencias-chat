"""Las revisiones que retiran las reglas simples, en un schema sin las
tablas de cada negocio.

``scripts.migrate`` corre cada revisión también en ``public``, que en
producción no tiene ``automation_rules``. El 2026-11-08 un deploy falló por
una revisión que lo daba por hecho (ver ``test_knowledge_migrations_postgres``).
"""

from __future__ import annotations

import importlib.util
import secrets
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import text

from tests.postgres_fixtures import app_engine, pg_dsn  # noqa: F401

VERSIONS = Path(__file__).resolve().parent.parent / "alembic" / "versions"
REVISIONS = ("a3d7e5c19f42_reglas_simples_retiradas", "c8f2b6d04a17_borra_columnas_reglas_simples")


def _load(name: str):
    spec = importlib.util.spec_from_file_location(name, VERSIONS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize("revision", REVISIONS)
async def test_runs_on_a_schema_without_automation_tables(app_engine, revision) -> None:  # noqa: F811
    module = _load(revision)
    schema = f"sin_automatizaciones_{secrets.token_hex(4)}"

    def run(connection) -> None:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        connection.execute(text(f'SET LOCAL search_path TO "{schema}"'))
        with Operations.context(MigrationContext.configure(connection)):
            module.upgrade()
            module.downgrade()

    async with app_engine.connect() as connection:
        transaction = await connection.begin()
        try:
            await connection.run_sync(run)
        finally:
            await transaction.rollback()

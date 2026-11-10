"""Las migraciones del conocimiento contra un schema SIN las tablas del
negocio, como ``public`` en producción.

El 2026-11-08 el deploy falló con "relation knowledge_chunks does not exist":
``scripts.migrate`` corre cada revisión primero en ``public`` y en producción
``public`` no tiene las tablas de conocimiento (viven en el schema de cada
negocio). En desarrollo y en el job de migraciones de CI ``public`` sí las
tiene, así que nada lo detectó. Esto reproduce el caso de producción.
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
# Revisiones que tocan tablas que solo existen en el schema de cada negocio.
REVISIONS = ("c3f8a2d6e417_notas_del_catalogo_a_fichas", "e6b1d9a4c752_embeddings_del_conocimiento")


def _load(name: str):
    spec = importlib.util.spec_from_file_location(name, VERSIONS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize("revision", REVISIONS)
async def test_runs_on_a_schema_without_knowledge_tables(app_engine, revision) -> None:  # noqa: F811
    module = _load(revision)
    schema = f"sin_conocimiento_{secrets.token_hex(4)}"

    def migrate(connection) -> None:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        # Solo el schema vacío, como la pasada de public en producción: con
        # public en el search_path, la tabla de public de la base de tests
        # escondería el problema.
        connection.execute(text(f'SET LOCAL search_path TO "{schema}"'))
        context = MigrationContext.configure(connection)
        with Operations.context(context):
            module.upgrade()
            module.downgrade()

    async with app_engine.connect() as connection:
        transaction = await connection.begin()
        try:
            await connection.run_sync(migrate)
        finally:
            # Nada de esto queda: el schema de prueba se va con el rollback.
            await transaction.rollback()

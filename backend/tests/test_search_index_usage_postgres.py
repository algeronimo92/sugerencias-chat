"""La búsqueda usa su índice de texto: la función que llaman las consultas
es la misma con la que se construyó el índice.

El 2026-11-24 la búsqueda de mensajes saturó la base de producción. El índice
por trigramas existía, pero estaba atado a ``public.f_unaccent`` y las
consultas llamaban a una copia de la función en el schema del negocio:
PostgreSQL no lo usaba nunca y recorría toda la tabla.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import text

from app.tenancy.context import validate_schema_name
from tests.postgres_fixtures import app_engine, pg_dsn, tenant  # noqa: F401

REVISION = Path(__file__).resolve().parent.parent / "alembic" / "versions" / "b5e9a2f7c063_busqueda_usa_su_indice.py"

# La función que encuentra una consulta sin calificar, y de cuál depende el
# índice de texto de los mensajes.
RESOLVED = "SELECT to_regprocedure('f_unaccent(text)')::oid"
INDEXED = """
    SELECT d.refobjid FROM pg_depend d
    JOIN pg_class c ON c.oid = d.objid AND d.classid = 'pg_class'::regclass
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_proc p ON p.oid = d.refobjid AND d.refclassid = 'pg_proc'::regclass
    WHERE n.nspname = current_schema() AND c.relname = 'idx_wsp_messages_content_trgm' AND p.proname = 'f_unaccent'
"""


def _revision():
    spec = importlib.util.spec_from_file_location("busqueda_usa_su_indice", REVISION)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


async def test_a_new_business_searches_with_the_function_of_its_index(app_engine, tenant) -> None:  # noqa: F811
    schema = validate_schema_name(tenant.schema_name)
    async with app_engine.connect() as connection:
        transaction = await connection.begin()
        try:
            await connection.execute(text(f'SET LOCAL search_path TO "{schema}", public'))
            resolved = (await connection.execute(text(RESOLVED))).scalar_one()
            indexed = (await connection.execute(text(INDEXED))).scalar_one()
        finally:
            await transaction.rollback()
    assert resolved == indexed


async def test_a_business_moved_from_public_stops_shadowing_the_function_of_its_index(app_engine, tenant) -> None:  # noqa: F811
    """Como DermicaPro: sus índices vinieron de ``public`` atados a
    ``public.f_unaccent`` y el schema tenía además su propia copia."""
    schema = validate_schema_name(tenant.schema_name)

    def run(connection) -> tuple[int, int, int]:
        connection.execute(text(f'SET LOCAL search_path TO "{schema}", public'))
        # Se deja el schema como quedó el de producción tras la mudanza.
        for index, table, column in (
            ("idx_wsp_messages_content_trgm", "wsp_messages", "content"),
            ("idx_wsp_messages_analysis_trgm", "wsp_messages", "analysis->>'summary'"),
            ("idx_leads_nombre_trgm", "leads", "nombre"),
        ):
            connection.execute(text(f"DROP INDEX {index}"))
            connection.execute(text(
                f"CREATE INDEX {index} ON {table} USING gin (public.f_unaccent({column}) gin_trgm_ops)"
            ))
        before = connection.execute(text(RESOLVED)).scalar_one()
        with Operations.context(MigrationContext.configure(connection)):
            _revision().upgrade()
        return before, connection.execute(text(RESOLVED)).scalar_one(), connection.execute(text(INDEXED)).scalar_one()

    async with app_engine.connect() as connection:
        transaction = await connection.begin()
        try:
            before, resolved, indexed = await connection.run_sync(run)
        finally:
            await transaction.rollback()
    assert before != indexed  # el problema: la consulta llamaba a otra función
    assert resolved == indexed


async def test_public_is_left_alone(app_engine) -> None:  # noqa: F811
    def run(connection) -> tuple[int, int]:
        connection.execute(text("SET LOCAL search_path TO public"))
        before = connection.execute(text(RESOLVED)).scalar_one()
        with Operations.context(MigrationContext.configure(connection)):
            module = _revision()
            module.upgrade()
            module.downgrade()
        return before, connection.execute(text(RESOLVED)).scalar_one()

    async with app_engine.connect() as connection:
        transaction = await connection.begin()
        try:
            before, after = await connection.run_sync(run)
        finally:
            await transaction.rollback()
    assert before is not None and before == after

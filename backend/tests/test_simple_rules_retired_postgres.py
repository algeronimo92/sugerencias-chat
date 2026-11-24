"""La revisión que retira las reglas simples, contra PostgreSQL.

El backend dejó de mirar ``builder_mode``: una regla simple que quedara viva
pasaría por flujo sin bloques y fallaría en cada disparo. La revisión la
archiva y cancela lo que tenía pendiente, sin tocar los flujos.
"""

from __future__ import annotations

import importlib.util
import secrets
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import select, text, update

from app.db.models.automations import AutomationExecution, AutomationRule
from app.db.uow import session_scope
from app.tenancy.context import tenant_context, validate_schema_name
from tests.postgres_fixtures import app_engine, pg_dsn, tenant  # noqa: F401
from tests.test_automation_store_postgres import _execution, _rule

REVISION = Path(__file__).resolve().parent.parent / "alembic" / "versions" / "a3d7e5c19f42_reglas_simples_retiradas.py"


def _revision():
    spec = importlib.util.spec_from_file_location("reglas_simples_retiradas", REVISION)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


async def _upgrade(app_engine, schema: str) -> None:  # noqa: F811
    def run(connection) -> None:
        connection.execute(text(f'SET LOCAL search_path TO "{schema}"'))
        with Operations.context(MigrationContext.configure(connection)):
            _revision().upgrade()

    async with app_engine.begin() as connection:
        await connection.run_sync(run)


async def test_a_leftover_simple_rule_is_archived_and_its_pending_work_cancelled(app_engine, tenant) -> None:  # noqa: F811
    with tenant_context(tenant):
        simple = await _rule(name="Regla vieja")
        flow = await _rule(name="Flujo")
        async with session_scope() as session:
            await session.execute(update(AutomationRule).where(AutomationRule.id == simple).values(builder_mode="simple"))
        pending = await _execution(simple, None)
        finished = await _execution(simple, None, status="completed")
        of_the_flow = await _execution(flow, None)

    await _upgrade(app_engine, validate_schema_name(tenant.schema_name))

    with tenant_context(tenant):
        async with session_scope() as session:
            rules = {
                row.id: row for row in (await session.execute(select(AutomationRule))).scalars()
            }
            statuses = {
                row.id: (row.status, row.error) for row in (await session.execute(select(AutomationExecution))).scalars()
            }
    assert rules[simple].deleted_at is not None and rules[simple].is_active is False
    assert rules[flow].deleted_at is None and rules[flow].is_active is True
    assert statuses[pending][0] == "cancelled" and "reglas simples" in statuses[pending][1]
    assert statuses[finished][0] == "completed"
    assert statuses[of_the_flow][0] == "scheduled"


async def test_runs_on_a_schema_without_automation_tables(app_engine) -> None:  # noqa: F811
    """``scripts.migrate`` también recorre public, que en producción no tiene
    las tablas de cada negocio."""
    schema = f"sin_automatizaciones_{secrets.token_hex(4)}"

    def run(connection) -> None:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        connection.execute(text(f'SET LOCAL search_path TO "{schema}"'))
        with Operations.context(MigrationContext.configure(connection)):
            module = _revision()
            module.upgrade()
            module.downgrade()

    async with app_engine.connect() as connection:
        transaction = await connection.begin()
        try:
            await connection.run_sync(run)
        finally:
            await transaction.rollback()

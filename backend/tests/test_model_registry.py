"""Paridad del registro ORM y de las FKs que Alembic no compara por search_path."""

import asyncpg
import pytest

from app.db.models import Base
from tests.test_tenant_postgres_integration import pg_dsn  # noqa: F401


CONTROL_TABLES = {
    "organizations",
    "organization_branding",
    "organization_domains",
    "whatsapp_connections",
    "tenant_schema_versions",
    "platform_settings",
    "platform_users",
    "platform_sessions",
    "webhook_inbox",
}
PUBLIC_FKS = {
    ("organization_branding", "organization_id", "organizations"),
    ("organization_domains", "organization_id", "organizations"),
    ("platform_sessions", "platform_user_id", "platform_users"),
    ("tenant_schema_versions", "organization_id", "organizations"),
    ("whatsapp_connections", "organization_id", "organizations"),
}


def test_registry_loads_control_and_tenant_models_once():
    tables = list(Base.metadata.tables.values())
    assert len(tables) == 54
    assert {table.name for table in tables if table.schema == "public"} == CONTROL_TABLES
    assert all(table.schema is None for table in tables if table.name not in CONTROL_TABLES)
    for child, column, parent in PUBLIC_FKS:
        table = Base.metadata.tables[f"public.{child}"]
        foreign_keys = [fk for fk in table.foreign_keys if fk.parent.name == column]
        assert len(foreign_keys) == 1
        assert foreign_keys[0].column.table.fullname == f"public.{parent}"


@pytest.mark.asyncio
async def test_migrated_public_foreign_keys_still_target_public(pg_dsn):
    dsn = pg_dsn.replace("postgresql+asyncpg://", "postgresql://", 1)
    connection = await asyncpg.connect(dsn=dsn, ssl=False)
    try:
        rows = await connection.fetch(
            """
            SELECT child.relname AS child_table,
                   child_column.attname AS child_column,
                   parent_ns.nspname AS parent_schema,
                   parent.relname AS parent_table
            FROM pg_constraint fk
            JOIN pg_class child ON child.oid = fk.conrelid
            JOIN pg_namespace child_ns ON child_ns.oid = child.relnamespace
            JOIN pg_class parent ON parent.oid = fk.confrelid
            JOIN pg_namespace parent_ns ON parent_ns.oid = parent.relnamespace
            JOIN pg_attribute child_column
              ON child_column.attrelid = child.oid
             AND child_column.attnum = fk.conkey[1]
            WHERE fk.contype = 'f'
              AND child_ns.nspname = 'public'
              AND cardinality(fk.conkey) = 1
            """
        )
    finally:
        await connection.close()
    present = {
        (row["child_table"], row["child_column"], row["parent_table"])
        for row in rows
        if row["parent_schema"] == "public"
    }
    assert PUBLIC_FKS <= present

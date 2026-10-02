"""Entorno de Alembic para el esquema de la aplicación.

Dos decisiones importantes:

1. **La conexión sale de `config.settings`**, no de `alembic.ini`. Evita tener
   la cadena en dos sitios y que alguien commitee credenciales sin querer.

2. **Hay objetos que Alembic no debe tocar.** `leads` y `wsp_messages` las
   escribe también n8n, y la base tiene tablas y columnas que este proyecto no
   declara. Sin el filtro de `include_object`, un `--autogenerate` propondría
   borrarlas. Comprobado contra el esquema real de producción: aparecerían
   `DROP TABLE n8n_chat_histories`, `DROP COLUMN leads.metadata`,
   `leads.ultimo_emisor`, `leads.tipo_objecion` y `wsp_messages.created_at`,
   todas en uso por el flujo de n8n. El filtro excluye la tabla `leads`
   entera de la comparación, así que da igual si alguna de sus columnas
   (como `ultimo_mensaje_at`) sí está mapeada en `db/models/`: mientras la
   tabla siga en `EXTERNAL_TABLES`, autogenerate nunca la compara.
"""

from __future__ import annotations

import asyncio
import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool, text
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from app.core.config import settings
from app.db.models import Base
from app.db.session import _to_async_url
from app.tenancy.context import validate_schema_name

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

# Tablas cuyo ciclo de vida no pertenece a esta aplicación. Se crean en la
# migración base para que una instalación desde cero funcione, pero quedan
# fuera de autogenerate: sus cambios se coordinan con n8n, no se deducen de
# db/models/.
EXTERNAL_TABLES = {"leads", "wsp_messages"}

# Tablas que sencillamente no son nuestras. Nunca deben aparecer en una
# migración, ni para crearlas ni para borrarlas.
FOREIGN_TABLE_PREFIXES = ("n8n_", "archived_")
FOREIGN_TABLE_MARKERS = ("_backup_",)

# Alembic refleja las referencias entre tablas de public sin el prefijo
# "public." por el search_path. El modelo debe conservarlo para resolver la
# FK antes de que exista un tenant; filtrar solo estas cinco comparaciones
# evita el falso remove/add. Su presencia real se comprueba en tests.
PUBLIC_SAME_SCHEMA_FKS = {
    ("organization_branding", "organization_id"),
    ("organization_domains", "organization_id"),
    ("platform_sessions", "platform_user_id"),
    ("tenant_schema_versions", "organization_id"),
    ("whatsapp_connections", "organization_id"),
}


def _is_foreign(name: str) -> bool:
    return name.startswith(FOREIGN_TABLE_PREFIXES) or any(
        marker in name for marker in FOREIGN_TABLE_MARKERS
    )


def include_object(obj, name, type_, reflected, compare_to) -> bool:
    if type_ == "foreign_key_constraint":
        columns = tuple(column.name for column in obj.columns)
        if len(columns) == 1 and (obj.table.name, columns[0]) in PUBLIC_SAME_SCHEMA_FKS:
            return False
    if type_ == "table":
        if _is_foreign(name):
            return False
        # La migración base sí debe crear las tablas externas: una instalación
        # desde cero (CI, un entorno de pruebas) las necesita para arrancar.
        # Sólo se excluyen de las comparaciones posteriores. Se activa con
        # ALEMBIC_BASELINE=1 al generar esa primera revisión, nunca después.
        if name in EXTERNAL_TABLES:
            return os.environ.get("ALEMBIC_BASELINE") == "1"
        return True
    # Las columnas e índices de las tablas externas se filtran por su tabla:
    # de lo contrario autogenerate propondría borrar las que n8n añadió.
    table_name = getattr(getattr(obj, "table", None), "name", None)
    if table_name and _is_foreign(table_name):
        return False
    if table_name in EXTERNAL_TABLES:
        return os.environ.get("ALEMBIC_BASELINE") == "1"
    return True


def include_name(name, type_, parent_names) -> bool:
    """No inspeccionar otros tenants al comparar el schema activo.

    Con include_schemas=True Alembic conserva los FK a public.organizations
    en lugar de interpretarlos como referencias a una tabla sin schema.
    """
    if type_ == "schema":
        tenant_schema = config.attributes.get("tenant_schema")
        return name in {None, "public", tenant_schema}
    return True


def _configure(connection: Connection) -> None:
    tenant_schema = config.attributes.get("tenant_schema")
    if not isinstance(tenant_schema, str):
        tenant_schema = None
    if tenant_schema:
        tenant_schema = validate_schema_name(tenant_schema)
        # El identificador ya pasó por una regex cerrada. SET LOCAL garantiza
        # que esta conexión vuelva limpia al pool al terminar la transacción.
        connection.execute(text(f'SET LOCAL search_path TO "{tenant_schema}", public'))
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        include_schemas=True,
        include_name=include_name,
        include_object=include_object,
        compare_type=True,
        compare_server_default=True,
        version_table_schema=tenant_schema,
    )


def run_migrations_offline() -> None:
    tenant_schema = config.attributes.get("tenant_schema")
    if not isinstance(tenant_schema, str):
        tenant_schema = None
    if tenant_schema:
        tenant_schema = validate_schema_name(tenant_schema)
    context.configure(
        url=_to_async_url(settings.database_url),
        target_metadata=target_metadata,
        include_object=include_object,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        version_table_schema=tenant_schema,
    )
    with context.begin_transaction():
        if tenant_schema:
            context.execute(f'SET search_path TO "{tenant_schema}", public')
        context.run_migrations()


def _run(connection: Connection) -> None:
    _configure(connection)
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    section = config.get_section(config.config_ini_section, {})
    section["sqlalchemy.url"] = _to_async_url(settings.database_url)
    engine = async_engine_from_config(
        section, prefix="sqlalchemy.", poolclass=pool.NullPool,
        connect_args={"ssl": settings.database_ssl, "timeout": 10},
    )
    async with engine.connect() as connection:
        await connection.run_sync(_run)
    await engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    # scripts/migrate.py ya tiene una conexión abierta (con el advisory lock
    # tomado) y llama a Alembic desde dentro del bucle de eventos. En ese caso
    # se reutiliza esa conexión: abrir otra aquí crearía un segundo bucle y
    # además dejaría el lock en una sesión distinta de la que hace el DDL.
    existing = config.attributes.get("connection")
    if existing is not None:
        _run(existing)
    else:
        asyncio.run(run_migrations_online())

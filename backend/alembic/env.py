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

3. **No se ejecuta DDL contra un host remoto sin pedirlo.** La decisión 1
   tiene un reverso: `settings` lee `backend/.env`, y en una máquina de
   desarrollo ese archivo puede apuntar a la base en servicio para ver datos
   reales. Con eso, `alembic upgrade head` o `python -m scripts.migrate` sin
   un `DATABASE_URL` explícito migrarían producción desde una laptop. Antes
   de escribir se mira el host: loopback, `*.localhost` o un nombre de
   servicio de Compose (sin puntos, como el `postgres` de producción y de
   desarrollo) pasan; cualquier otro —una IP pública, un dominio, la IP de un
   túnel— exige `ALEMBIC_ALLOW_REMOTE=1`. Leer no pide nada: `alembic check`,
   `current` y `revision --autogenerate` siguen sirviendo para comparar el
   esquema de producción sin tocarlo.
"""

from __future__ import annotations

import asyncio
import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool, text
from sqlalchemy.engine import Connection, make_url
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


# Comandos de Alembic que solo leen la base: comparar, mostrar la revisión o
# proponer una migración. Todo lo demás (upgrade, downgrade, stamp) escribe.
READ_ONLY_COMMANDS = frozenset({"check", "current", "revision"})

LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})


def is_local_database_host(host: str | None) -> bool:
    """¿Es el Postgres de esta máquina o de este Compose?

    Un socket Unix (sin host), loopback, ``*.localhost`` o un nombre sin
    puntos (el servicio ``postgres`` de compose.yml y de compose.prod.yml, el
    ``localhost`` de CI) cuentan como locales. Una IP que no sea loopback o
    cualquier nombre con puntos es otra máquina, aunque sea privada: la IP de
    un túnel WireGuard también es producción.
    """
    if not host:
        return True
    name = host.strip("[]").lower()
    if name in LOCAL_HOSTS or name.endswith(".localhost") or name.startswith("127."):
        return True
    return "." not in name and ":" not in name


def _alembic_command_name() -> str | None:
    """Nombre del comando de la CLI, o None cuando se invoca por código."""
    cmd = getattr(getattr(config, "cmd_opts", None), "cmd", None)
    if not cmd:
        return None
    return getattr(cmd[0], "__name__", None)


def refuse_remote_database(url: str, command: str | None, allow: str | None) -> None:
    """Levanta RuntimeError si se va a escribir en un host que no es local.

    ``allow`` es el valor de ``ALEMBIC_ALLOW_REMOTE``; "1" deja pasar. Se
    recibe por parámetro, igual que ``command``, para que la regla sea pura y
    se pruebe sin tocar el entorno.
    """
    if command in READ_ONLY_COMMANDS or allow == "1":
        return
    host = make_url(url).host
    if is_local_database_host(host):
        return
    raise RuntimeError(
        f"Alembic iba a escribir en {host!r}, que no es una base local. "
        "DATABASE_URL sale de backend/.env (o del entorno); si de verdad hay que "
        "migrar esa base, exportar ALEMBIC_ALLOW_REMOTE=1. Para comparar sin "
        "escribir, `alembic check` no necesita permiso."
    )


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
    # Antes de cualquiera de las dos ramas: la conexión inyectada ya está
    # abierta, pero el DDL todavía no empezó y es lo único que se frena.
    refuse_remote_database(
        settings.database_url, _alembic_command_name(), os.environ.get("ALEMBIC_ALLOW_REMOTE")
    )
    existing = config.attributes.get("connection")
    if existing is not None:
        _run(existing)
    else:
        asyncio.run(run_migrations_online())

"""Aplica las migraciones de Alembic de forma segura para varios procesos.

Resuelve dos problemas que el arranque de la aplicación tenía:

1. **Varias instancias arrancando a la vez.** El DDL vivía en el lifespan de
   FastAPI, así que cada réplica lo ejecutaba. Dos procesos comprobando "¿existe
   este índice?" a la vez respondían que no los dos, y el segundo `CREATE INDEX`
   reventaba. Aquí se toma un advisory lock de PostgreSQL: el primero migra, el
   resto espera y encuentra el trabajo hecho.

2. **Bases que ya existen y no conocen Alembic.** Aplicar la migración base
   sobre producción intentaría crear tablas que ya están. Si se detecta un
   esquema poblado sin `alembic_version`, se marca (`stamp`) en la revisión
   base en vez de ejecutarla: el esquema ya está en ese punto, sólo faltaba
   decirlo.

Uso:
    python -m scripts.migrate            # aplica lo pendiente
    python -m scripts.migrate --check    # sólo informa, no modifica nada
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import text

from db.session import close_engine, get_engine

BACKEND_DIR = Path(__file__).resolve().parent.parent

# Entero arbitrario pero estable: identifica este proyecto dentro del espacio
# de advisory locks compartido de la base.
MIGRATION_LOCK_ID = 728_413_905

# Si esta tabla existe, la base ya tenía el esquema de la aplicación antes de
# que existiera Alembic. Se elige `users` porque la crea la propia aplicación
# (no n8n) y está presente en cualquier instalación funcionando.
SENTINEL_TABLE = "users"


def _alembic_config() -> Config:
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    return config


def _baseline_revision(config: Config) -> str:
    revisions = list(ScriptDirectory.from_config(config).walk_revisions())
    return revisions[-1].revision


def _current_revision(connection) -> str | None:
    return MigrationContext.configure(connection).get_current_revision()


def _table_exists(connection, table: str) -> bool:
    return bool(connection.execute(text(
        "SELECT EXISTS (SELECT 1 FROM information_schema.tables "
        "WHERE table_schema = current_schema() AND table_name = :table)"
    ), {"table": table}).scalar())


def _plan(connection, config: Config) -> tuple[str, str | None]:
    """Devuelve (accion, detalle) sin modificar nada."""
    current = _current_revision(connection)
    if current is not None:
        head = ScriptDirectory.from_config(config).get_current_head()
        if current == head:
            return "al-dia", current
        return "migrar", current
    if _table_exists(connection, SENTINEL_TABLE):
        return "marcar", _baseline_revision(config)
    return "crear", None


def _run(connection, config: Config, check_only: bool) -> int:
    action, detail = _plan(connection, config)

    if action == "al-dia":
        print(f"Esquema al día en la revisión {detail}")
        return 0

    if check_only:
        print(f"Pendiente: {action} (revisión actual: {detail or 'ninguna'})")
        return 1

    config.attributes["connection"] = connection

    if action == "marcar":
        print(
            f"Base existente sin Alembic: se marca en la baseline {detail} "
            "sin ejecutar DDL (el esquema ya está en ese punto)"
        )
        command.stamp(config, detail)
        # Puede haber revisiones posteriores a la baseline que sí toque aplicar.
        command.upgrade(config, "head")
        return 0

    if action == "crear":
        print("Base vacía: se crea el esquema completo desde la baseline")
    else:
        print(f"Aplicando migraciones desde {detail}")
    command.upgrade(config, "head")
    print(f"Esquema en {_current_revision(connection)}")
    return 0


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check", action="store_true",
        help="informa si hay migraciones pendientes sin aplicarlas",
    )
    args = parser.parse_args()

    config = _alembic_config()
    engine = get_engine()
    try:
        async with engine.begin() as connection:
            if not args.check:
                # Bloqueante a propósito: si otra instancia está migrando,
                # esperar es exactamente lo que queremos.
                await connection.execute(
                    text("SELECT pg_advisory_lock(:id)"), {"id": MIGRATION_LOCK_ID}
                )
            try:
                return await connection.run_sync(_run, config, args.check)
            finally:
                if not args.check:
                    await connection.execute(
                        text("SELECT pg_advisory_unlock(:id)"), {"id": MIGRATION_LOCK_ID}
                    )
    finally:
        await close_engine()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

"""Roles de PostgreSQL y sus privilegios: lo que ejecuta la base.

Qué privilegios le tocan a cada rol lo decide ``app/modules/auth/db_privileges.py``;
acá solo se crean los roles, se aplican ``GRANT``/``REVOKE`` y se fija el rol
de cada transacción. Todo identificador que llega a un SQL armado a mano pasa
por una lista cerrada o por una expresión regular: nunca sale de un input.
"""

from __future__ import annotations

import logging
import re
from contextvars import ContextVar

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncSession

from app.tenancy.context import validate_schema_name

logger = logging.getLogger(__name__)

DB_ROLE_NAMES: frozenset[str] = frozenset({"cv_admin", "cv_vendedor", "cv_analista"})
PRIVILEGES: frozenset[str] = frozenset({"SELECT", "INSERT", "UPDATE", "DELETE"})
_IDENTIFIER_RE = re.compile(r"^[a-z_][a-z0-9_]{0,62}$")

# El rol de PostgreSQL de la petición en curso; ``None`` fuera de una petición
# (workers, webhooks, migraciones), que siguen con el usuario de la conexión.
_request_db_role: ContextVar[str | None] = ContextVar("request_db_role", default=None)
# Lo decide el arranque (``check_db_roles``): sin los roles listos, pedirlos
# haría fallar cada petición.
_enforcement_active = False


def _ident(name: str) -> str:
    if not _IDENTIFIER_RE.fullmatch(name):
        raise ValueError(f"Identificador inválido: {name!r}")
    return f'"{name}"'


def _role(name: str) -> str:
    if name not in DB_ROLE_NAMES:
        raise ValueError(f"Rol de base desconocido: {name!r}")
    return _ident(name)


def enforcement_active() -> bool:
    return _enforcement_active


def set_request_db_role(role: str | None) -> None:
    if role is not None and role not in DB_ROLE_NAMES:
        raise ValueError(f"Rol de base desconocido: {role!r}")
    _request_db_role.set(role if _enforcement_active else None)


def request_db_role() -> str | None:
    return _request_db_role.get()


def set_local_role_sql() -> str | None:
    """``SET LOCAL ROLE`` de la petición en curso, o None si no corresponde."""
    role = _request_db_role.get()
    return f"SET LOCAL ROLE {_role(role)}" if role else None


async def ensure_db_roles(connection: AsyncConnection) -> bool:
    """Crea los roles si faltan y hace a la conexión miembro de cada uno (para
    poder ``SET ROLE``). Pide ``CREATEROLE``; sin él, avisa y devuelve False."""
    existing = set((await connection.execute(
        text("SELECT rolname FROM pg_roles WHERE rolname = ANY(:names)"), {"names": sorted(DB_ROLE_NAMES)},
    )).scalars().all())
    can_create = (await connection.execute(
        text("SELECT rolsuper OR rolcreaterole FROM pg_roles WHERE rolname = current_user")
    )).scalar_one()
    missing = DB_ROLE_NAMES - existing
    if missing and not can_create:
        logger.warning("Faltan los roles de base %s y el usuario no tiene CREATEROLE", sorted(missing))
        return False
    for name in sorted(missing):
        # Privilegios de sistema: ninguno. No inician sesión, no crean bases
        # ni roles, no se saltan RLS y no heredan nada por defecto.
        await connection.execute(text(
            f"CREATE ROLE {_role(name)} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS"
        ))
    for name in sorted(DB_ROLE_NAMES):
        member = (await connection.execute(
            text("SELECT pg_has_role(current_user, :role, 'MEMBER')"), {"role": name},
        )).scalar_one()
        if not member:
            await connection.execute(text(f"GRANT {_role(name)} TO CURRENT_USER"))
    # Leer el plano de control sin tocar usuarios ni sesiones de la plataforma.
    await connection.execute(text(f"GRANT USAGE ON SCHEMA public TO {', '.join(_role(n) for n in sorted(DB_ROLE_NAMES))}"))
    return True


async def grant_control_reads(connection: AsyncConnection, tables: tuple[str, ...]) -> None:
    roles = ", ".join(_role(name) for name in sorted(DB_ROLE_NAMES))
    present = set((await connection.execute(text(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY(:t)"
    ), {"t": list(tables)})).scalars().all())
    for table in sorted(present):
        await connection.execute(text(f"GRANT SELECT ON public.{_ident(table)} TO {roles}"))


async def apply_schema_grants(session: AsyncSession, schema: str, grants: dict[str, dict[str, frozenset[str]]]) -> None:
    """Deja a cada rol con exactamente ``grants[rol]`` en ``schema``.

    ``grants[rol]`` es ``{"tabla": privilegios, "tabla.columna": privilegios}``.
    Corre como dueño (``RESET ROLE``): solo él puede dar y quitar privilegios.
    """
    schema_sql = _ident(validate_schema_name(schema))
    previous = request_db_role()
    await session.execute(text("RESET ROLE"))
    try:
        present = set((await session.execute(text(
            "SELECT table_name FROM information_schema.tables WHERE table_schema = :s"
        ), {"s": schema})).scalars().all())
        # Privilegio de sistema: nadie más que el dueño crea objetos acá.
        await session.execute(text(f"REVOKE CREATE ON SCHEMA {schema_sql} FROM PUBLIC"))
        for role, targets in grants.items():
            role_sql = _role(role)
            await session.execute(text(f"REVOKE CREATE ON SCHEMA {schema_sql} FROM {role_sql}"))
            await session.execute(text(f"GRANT USAGE ON SCHEMA {schema_sql} TO {role_sql}"))
            await session.execute(text(f"REVOKE ALL ON ALL TABLES IN SCHEMA {schema_sql} FROM {role_sql}"))
            # REVOKE sobre la tabla no quita los de columna: se buscan aparte.
            columns = (await session.execute(text(
                "SELECT DISTINCT table_name, column_name FROM information_schema.column_privileges "
                "WHERE grantee = :role AND table_schema = :s"
            ), {"role": role, "s": schema})).all()
            for table, column in columns:
                await session.execute(text(
                    f"REVOKE ALL ({_ident(column)}) ON {schema_sql}.{_ident(table)} FROM {role_sql}"
                ))
            # Los INSERT con id serial necesitan la secuencia.
            await session.execute(text(f"GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA {schema_sql} TO {role_sql}"))
            for target, privileges in sorted(targets.items()):
                table, _, column = target.partition(".")
                if table not in present:
                    continue
                unknown = set(privileges) - PRIVILEGES
                if unknown:
                    raise ValueError(f"Privilegio inválido: {sorted(unknown)}")
                if column:
                    listed = ", ".join(f"{privilege} ({_ident(column)})" for privilege in sorted(privileges))
                else:
                    listed = ", ".join(sorted(privileges))
                await session.execute(text(f"GRANT {listed} ON {schema_sql}.{_ident(table)} TO {role_sql}"))
    finally:
        if previous:
            await session.execute(text(f"SET LOCAL ROLE {_role(previous)}"))


async def describe_privileges(session: AsyncSession, schema: str) -> list[dict]:
    """Lo que PostgreSQL dice hoy de cada rol: atributos de sistema, privilegios
    sobre el schema y privilegios de objeto (por tabla y por columna)."""
    rows = (await session.execute(text(
        "SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolcanlogin, rolbypassrls, "
        "has_schema_privilege(rolname, :s, 'USAGE') AS schema_usage, "
        "has_schema_privilege(rolname, :s, 'CREATE') AS schema_create "
        "FROM pg_roles WHERE rolname = ANY(:names) ORDER BY rolname"
    ), {"s": schema, "names": sorted(DB_ROLE_NAMES)})).mappings().all()
    tables = (await session.execute(text(
        "SELECT grantee, table_name, privilege_type FROM information_schema.role_table_grants "
        "WHERE table_schema = :s AND grantee = ANY(:names)"
    ), {"s": schema, "names": sorted(DB_ROLE_NAMES)})).all()
    columns = (await session.execute(text(
        "SELECT grantee, table_name, column_name, privilege_type FROM information_schema.column_privileges "
        "WHERE table_schema = :s AND grantee = ANY(:names)"
    ), {"s": schema, "names": sorted(DB_ROLE_NAMES)})).all()
    by_role: dict[str, dict[str, set[str]]] = {}
    for grantee, table, privilege in tables:
        by_role.setdefault(grantee, {}).setdefault(table, set()).add(privilege)
    for grantee, table, column, privilege in columns:
        # Un GRANT de tabla también aparece por cada columna: solo se listan
        # los que la tabla no tiene entera.
        if privilege not in by_role.get(grantee, {}).get(table, set()):
            by_role.setdefault(grantee, {}).setdefault(f"{table}.{column}", set()).add(privilege)
    return [
        {
            "db_role": row["rolname"],
            "system": {
                "superuser": row["rolsuper"], "create_db": row["rolcreatedb"],
                "create_role": row["rolcreaterole"], "login": row["rolcanlogin"],
                "bypass_rls": row["rolbypassrls"], "schema_usage": row["schema_usage"],
                "schema_create": row["schema_create"],
            },
            "objects": [
                {"object": target, "privileges": sorted(privileges)}
                for target, privileges in sorted(by_role.get(row["rolname"], {}).items())
            ],
        }
        for row in rows
    ]


async def check_db_roles(connection: AsyncConnection, *, enabled: bool) -> bool:
    """Activa ``SET LOCAL ROLE`` solo si la conexión puede asumir los tres roles."""
    global _enforcement_active
    if not enabled:
        _enforcement_active = False
        return False
    ready = True
    for name in sorted(DB_ROLE_NAMES):
        if not await _role_exists(connection, name) or not (await connection.execute(
            text("SELECT pg_has_role(current_user, :role, 'MEMBER')"), {"role": name},
        )).scalar_one():
            ready = False
    _enforcement_active = ready
    if not _enforcement_active:
        logger.error(
            "DB_ROLE_ENFORCEMENT está encendido pero faltan los roles de base o la conexión no es "
            "miembro de ellos: correr scripts.migrate. Las peticiones siguen sin SET ROLE."
        )
    return _enforcement_active


async def _role_exists(connection: AsyncConnection, name: str) -> bool:
    return (await connection.execute(
        text("SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :n)"), {"n": name},
    )).scalar_one()

"""Roles de PostgreSQL y sus privilegios: lo que ejecuta la base.

Qué privilegios le tocan a cada rol lo decide ``app/modules/auth/db_privileges.py``;
acá solo se crean los roles, se aplican ``GRANT``/``REVOKE`` y se fija el rol
de cada transacción. Todo identificador que llega a un SQL armado a mano pasa
por una lista cerrada o por una expresión regular: nunca sale de un input.

Cada negocio tiene sus propios tres roles: ``cv_<id>_admin``, ``cv_<id>_vendedor``
y ``cv_<id>_analista``, donde ``<id>`` es el de su schema (``tenant_<id>``). Solo
tienen privilegios en ese schema, así que la base misma impide que una
petición de un negocio lea o escriba las tablas de otro, aunque el
``search_path`` fallara.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import re
import secrets
from contextvars import ContextVar

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncSession

from app.tenancy.context import validate_schema_name

logger = logging.getLogger(__name__)

# El rol de la app dentro del nombre del rol de base.
DB_ROLE_SUFFIXES: frozenset[str] = frozenset({"admin", "vendedor", "analista"})
PRIVILEGES: frozenset[str] = frozenset({"SELECT", "INSERT", "UPDATE", "DELETE"})
_IDENTIFIER_RE = re.compile(r"^[a-z_][a-z0-9_]{0,62}$")

# El rol de la app de la petición en curso; ``None`` fuera de una petición
# (workers, webhooks, migraciones), que siguen con el usuario de la conexión.
_request_db_role: ContextVar[str | None] = ContextVar("request_db_role", default=None)
# Lo decide el arranque (``check_db_roles``): sin los roles listos, pedirlos
# haría fallar cada petición.
_enforcement_active = False


def _ident(name: str) -> str:
    if not _IDENTIFIER_RE.fullmatch(name):
        raise ValueError(f"Identificador inválido: {name!r}")
    return f'"{name}"'


def tenant_db_role(schema: str, suffix: str) -> str:
    """``tenant_<id>`` + ``vendedor`` → ``cv_<id>_vendedor``."""
    if suffix not in DB_ROLE_SUFFIXES:
        raise ValueError(f"Rol de base desconocido: {suffix!r}")
    tenant_id = validate_schema_name(schema).removeprefix("tenant_")
    return f"cv_{tenant_id}_{suffix}"


def tenant_db_roles(schema: str) -> dict[str, str]:
    """Los roles con que la app atiende peticiones del negocio (SET LOCAL ROLE)."""
    return {suffix: tenant_db_role(schema, suffix) for suffix in sorted(DB_ROLE_SUFFIXES)}


# El negocio como dueño de sus datos: lee y escribe todo su schema y nada
# fuera de él. No inicia sesión; el login del negocio (p. ej. ``dermicapro``)
# es miembro de este rol, y la app nunca lo usa para atender peticiones.
BUSINESS_ROLE_SUFFIX = "negocio"
BUSINESS_PRIVILEGES = "SELECT, INSERT, UPDATE, DELETE, TRUNCATE"


def tenant_business_role(schema: str) -> str:
    tenant_id = validate_schema_name(schema).removeprefix("tenant_")
    return f"cv_{tenant_id}_{BUSINESS_ROLE_SUFFIX}"


def all_tenant_roles(schema: str) -> list[str]:
    return sorted([*tenant_db_roles(schema).values(), tenant_business_role(schema)])


def enforcement_active() -> bool:
    return _enforcement_active


def set_request_db_role(suffix: str | None) -> None:
    if suffix is not None and suffix not in DB_ROLE_SUFFIXES:
        raise ValueError(f"Rol de base desconocido: {suffix!r}")
    _request_db_role.set(suffix if _enforcement_active else None)


def request_db_role() -> str | None:
    return _request_db_role.get()


def set_local_role_sql(schema: str) -> str | None:
    """``SET LOCAL ROLE`` de la petición en curso en ``schema``, o None."""
    suffix = _request_db_role.get()
    return f"SET LOCAL ROLE {_ident(tenant_db_role(schema, suffix))}" if suffix else None


async def ensure_tenant_db_roles(session: AsyncSession, schema: str) -> bool:
    """Crea los roles del negocio si faltan y hace a la conexión miembro de
    cada uno (para poder ``SET ROLE``). Pide ``CREATEROLE``; sin él, avisa y
    devuelve False."""
    names = all_tenant_roles(schema)
    existing = set((await session.execute(
        text("SELECT rolname FROM pg_roles WHERE rolname = ANY(:names)"), {"names": sorted(names)},
    )).scalars().all())
    missing = set(names) - existing
    if missing:
        can_create = (await session.execute(
            text("SELECT rolsuper OR rolcreaterole FROM pg_roles WHERE rolname = current_user")
        )).scalar_one()
        if not can_create:
            logger.warning("Faltan los roles de base de %s y el usuario no tiene CREATEROLE", schema)
            return False
    for name in sorted(missing):
        # Privilegios de sistema: ninguno. No inician sesión, no crean bases
        # ni roles, no se saltan RLS y no heredan nada por defecto.
        await session.execute(text(
            f"CREATE ROLE {_ident(name)} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS"
        ))
    # La conexión asume con SET ROLE los roles de la app (no el del negocio).
    # Se mira 'SET' y no 'MEMBER': quien crea un rol con CREATEROLE queda como
    # miembro con ADMIN pero sin SET, y 'MEMBER' ya daría verdadero.
    for name in sorted(tenant_db_roles(schema).values()):
        can_set = (await session.execute(
            text("SELECT pg_has_role(current_user, :role, 'SET')"), {"role": name},
        )).scalar_one()
        if not can_set:
            await session.execute(text(f"GRANT {_ident(name)} TO CURRENT_USER WITH INHERIT FALSE, SET TRUE"))
    return True


async def _grant_business_role(session: AsyncSession, schema: str) -> None:
    """Todo el DML del schema para el rol del negocio; nada de DDL ni de public."""
    schema_sql = _ident(validate_schema_name(schema))
    role_sql = _ident(tenant_business_role(schema))
    await session.execute(text(f"REVOKE CREATE ON SCHEMA {schema_sql} FROM {role_sql}"))
    await session.execute(text(f"GRANT USAGE ON SCHEMA {schema_sql} TO {role_sql}"))
    await session.execute(text(f"GRANT {BUSINESS_PRIVILEGES} ON ALL TABLES IN SCHEMA {schema_sql} TO {role_sql}"))
    await session.execute(text(f"GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA {schema_sql} TO {role_sql}"))


async def apply_schema_grants(
    session: AsyncSession,
    schema: str,
    grants: dict[str, dict[str, frozenset[str]]],
    control_reads: tuple[str, ...] = (),
) -> bool:
    """Deja a cada rol del negocio con exactamente ``grants[sufijo]`` en ``schema``.

    ``grants[sufijo]`` es ``{"tabla": privilegios, "tabla.columna": privilegios}``;
    ``control_reads``, las tablas de ``public`` que pueden leer. Corre como
    dueño (``RESET ROLE``): solo él puede crear roles y dar o quitar privilegios.
    Devuelve False si los roles no existen ni se pueden crear.
    """
    schema_sql = _ident(validate_schema_name(schema))
    previous = request_db_role()
    await session.execute(text("RESET ROLE"))
    try:
        if not await ensure_tenant_db_roles(session, schema):
            return False
        present = set((await session.execute(text(
            "SELECT table_name FROM information_schema.tables WHERE table_schema = :s"
        ), {"s": schema})).scalars().all())
        control_present = set((await session.execute(text(
            "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY(:t)"
        ), {"t": list(control_reads)})).scalars().all())
        # Privilegio de sistema: nadie más que el dueño crea objetos acá.
        await session.execute(text(f"REVOKE CREATE ON SCHEMA {schema_sql} FROM PUBLIC"))
        for suffix, targets in grants.items():
            role = tenant_db_role(schema, suffix)
            role_sql = _ident(role)
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
            await session.execute(text(f"GRANT USAGE ON SCHEMA public TO {role_sql}"))
            for table in sorted(control_present):
                await session.execute(text(f"GRANT SELECT ON public.{_ident(table)} TO {role_sql}"))
        await _grant_business_role(session, schema)
        return True
    finally:
        if previous:
            await session.execute(text(f"SET LOCAL ROLE {_ident(tenant_db_role(schema, previous))}"))


async def can_create_roles(session: AsyncSession) -> bool:
    """Si el usuario de la conexión puede crear los roles de un negocio.
    ``session_user`` y no ``current_user``: con SET ROLE activo, el segundo es
    el rol del negocio, que nunca puede."""
    return bool((await session.execute(
        text("SELECT rolsuper OR rolcreaterole FROM pg_roles WHERE rolname = session_user")
    )).scalar_one_or_none())


async def describe_privileges(session: AsyncSession, schema: str) -> list[dict]:
    """Lo que PostgreSQL dice hoy de cada rol del negocio: atributos de
    sistema, privilegios sobre el schema y privilegios de objeto (por tabla y
    por columna)."""
    names = all_tenant_roles(schema)
    rows = (await session.execute(text(
        "SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolcanlogin, rolbypassrls, "
        "has_schema_privilege(rolname, :s, 'USAGE') AS schema_usage, "
        "has_schema_privilege(rolname, :s, 'CREATE') AS schema_create "
        "FROM pg_roles WHERE rolname = ANY(:names) ORDER BY rolname"
    ), {"s": schema, "names": names})).mappings().all()
    tables = (await session.execute(text(
        "SELECT grantee, table_name, privilege_type FROM information_schema.role_table_grants "
        "WHERE table_schema = :s AND grantee = ANY(:names)"
    ), {"s": schema, "names": names})).all()
    columns = (await session.execute(text(
        "SELECT grantee, table_name, column_name, privilege_type FROM information_schema.column_privileges "
        "WHERE table_schema = :s AND grantee = ANY(:names)"
    ), {"s": schema, "names": names})).all()
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


# --- Login propio de cada negocio ------------------------------------------

# Nombres que un negocio no puede tomar: los usuarios del servidor y los
# prefijos de los roles internos.
RESERVED_LOGINS = frozenset({"postgres", "cliniventas", "cliniventas_app", "n8n_app", "postgres_exporter"})
_LOGIN_RE = re.compile(r"^[a-z][a-z0-9_]{2,40}$")


class BusinessLoginError(ValueError):
    pass


def business_login_name(hostname: str) -> str:
    """``norte.cliniventas.com`` → ``norte``: el subdominio del negocio."""
    name = hostname.strip().lower().split(".", 1)[0].replace("-", "_")
    if not _LOGIN_RE.fullmatch(name) or name in RESERVED_LOGINS or name.startswith(("cv_", "pg_")):
        raise BusinessLoginError(f"El dominio no sirve como usuario de base: {name!r}")
    return name


def scram_verifier(password: str, *, iterations: int = 4096) -> str:
    """La contraseña como la guarda PostgreSQL (SCRAM-SHA-256). Se manda ya
    cifrada: así nunca viaja en claro en un CREATE/ALTER ROLE que podría
    quedar en el log de sentencias del servidor."""
    salt = secrets.token_bytes(16)
    salted = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    client_key = hmac.new(salted, b"Client Key", hashlib.sha256).digest()
    stored_key = hashlib.sha256(client_key).digest()
    server_key = hmac.new(salted, b"Server Key", hashlib.sha256).digest()
    b64 = lambda raw: base64.b64encode(raw).decode("ascii")  # noqa: E731
    return f"SCRAM-SHA-256${iterations}:{b64(salt)}${b64(stored_key)}:{b64(server_key)}"


async def find_business_login(session: AsyncSession, schema: str) -> str | None:
    """El login del negocio: el que inicia sesión y es miembro de su rol dueño."""
    return (await session.execute(text(
        "SELECT m.rolname FROM pg_auth_members a "
        "JOIN pg_roles r ON r.oid = a.roleid JOIN pg_roles m ON m.oid = a.member "
        "WHERE r.rolname = :role AND m.rolcanlogin ORDER BY m.rolname LIMIT 1"
    ), {"role": tenant_business_role(schema)})).scalar_one_or_none()


async def set_business_login(session: AsyncSession, schema: str, login: str, password: str) -> None:
    """Crea (o adopta) el login del negocio, le pone ``password`` y lo hace
    miembro de su rol dueño. Corre como dueño (``RESET ROLE``)."""
    if not _LOGIN_RE.fullmatch(login) or login in RESERVED_LOGINS:
        raise BusinessLoginError(f"Usuario de base inválido: {login!r}")
    business_role = tenant_business_role(schema)
    await session.execute(text("RESET ROLE"))
    exists_role = (await session.execute(
        text("SELECT 1 FROM pg_roles WHERE rolname = :r"), {"r": business_role},
    )).scalar_one_or_none()
    if not exists_role:
        raise BusinessLoginError("El negocio todavía no tiene su rol en la base: falta correr las migraciones")
    current = (await session.execute(text(
        "SELECT rolsuper OR rolcreaterole OR rolcreatedb OR rolbypassrls AS powerful, "
        "EXISTS (SELECT 1 FROM pg_auth_members a JOIN pg_roles r ON r.oid = a.roleid "
        "        WHERE a.member = pg_roles.oid AND r.rolname <> :business) AS other "
        "FROM pg_roles WHERE rolname = :login"
    ), {"login": login, "business": business_role})).mappings().one_or_none()
    # El verificador lleva ":" (iteraciones:sal, clave:clave) y text() toma
    # cada ":palabra" como parámetro: se escapan. El CI lo atrapó con el test
    # que inicia sesión de verdad (2026-11-21).
    verifier = scram_verifier(password).replace(":", r"\:")
    if current is None:
        await session.execute(text(
            f"CREATE ROLE {_ident(login)} LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS "
            f"PASSWORD '{verifier}'"
        ))
    else:
        # Un nombre ya tomado solo se adopta si es un login sin poderes y sin
        # otros roles: nunca el de otro negocio ni un usuario del servidor.
        if current["powerful"] or current["other"]:
            raise BusinessLoginError(f"El usuario de base {login!r} ya existe y no es de este negocio")
        await session.execute(text(f"ALTER ROLE {_ident(login)} WITH LOGIN PASSWORD '{verifier}'"))
    database = (await session.execute(text("SELECT current_database()"))).scalar_one()
    await session.execute(text(f"GRANT CONNECT ON DATABASE {_ident(database)} TO {_ident(login)}"))
    member = (await session.execute(
        text("SELECT pg_has_role(:login, :role, 'MEMBER')"), {"login": login, "role": business_role},
    )).scalar_one()
    if not member:
        await session.execute(text(f"GRANT {_ident(business_role)} TO {_ident(login)}"))


async def current_database(session: AsyncSession) -> str:
    return (await session.execute(text("SELECT current_database()"))).scalar_one()


async def check_db_roles(connection: AsyncConnection, *, enabled: bool) -> bool:
    """Activa ``SET LOCAL ROLE`` solo si la conexión puede asumir los roles de
    todos los negocios activos. Uno que falte apaga la barrera entera en vez
    de dejar a ese negocio sin poder atender."""
    global _enforcement_active
    if not enabled:
        _enforcement_active = False
        return False
    schemas = (await connection.execute(text(
        "SELECT schema_name FROM public.organizations WHERE status = 'active' ORDER BY schema_name"
    ))).scalars().all()
    missing: list[str] = []
    for schema in schemas:
        for name in tenant_db_roles(schema).values():
            # pg_has_role falla con un rol inexistente: primero se mira si existe.
            ready = (await connection.execute(text(
                "SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :n) "
                "THEN pg_has_role(current_user, :n, 'SET') ELSE false END"
            ), {"n": name})).scalar_one()
            if not ready:
                missing.append(name)
    _enforcement_active = not missing
    if missing:
        logger.error(
            "DB_ROLE_ENFORCEMENT está encendido pero faltan %d roles de base (%s…) o la conexión no es "
            "miembro de ellos: correr scripts.migrate. Las peticiones siguen sin SET ROLE.",
            len(missing), missing[0],
        )
    return _enforcement_active

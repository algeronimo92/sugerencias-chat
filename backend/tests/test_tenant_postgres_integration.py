"""Aislamiento entre tenants contra un PostgreSQL real con schemas físicos.

``test_tenancy_core.py`` prueba la misma lógica con SQLite y dobles: sirve
para la lógica pura (armado de search_path, contextvars, etc.) pero nunca
ejercitó Postgres de verdad, así que nunca pudo detectar una fuga real de
schema entre tenants ni una colisión de unicidad. Esta prueba sí:

1. Aprovisiona dos tenants reales (dos schemas físicos) con
   ``tenancy.provisioning.provision_tenant`` -- el mismo camino que usa
   ``scripts/provision_tenant.py`` en producción -- contra el Postgres de
   desarrollo levantado por ``compose.yml`` (servicio ``postgres``,
   ``127.0.0.1:5433``).
2. Fuerza la reutilización de una única conexión física del pool
   (``pool_size=1``) en la secuencia A -> B -> control y confirma, escuchando
   el evento ``checkout`` del pool, que de verdad fue la misma conexión.
3. Confirma que la unicidad de ``users.email`` es por schema, no global.
4. Confirma que un id conocido de una fila creada en el tenant B no se puede
   leer ni actualizar desde una sesión abierta con el contexto del tenant A.
5. Limpia los dos schemas y sus registros de control al terminar, incluso si
   alguna aserción falla.

Si no hay Postgres real accesible en 127.0.0.1:5433 (por ejemplo en un CI sin
Docker), el test se salta explícitamente en vez de fallar con un error de
conexión críptico.
"""

from __future__ import annotations

import secrets
import socket
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

import pytest
import pytest_asyncio
from sqlalchemy import event, select, text, update

from config import settings
from db.models import User
from db.session import close_engine, control_session, get_engine, tenant_session
from tenancy.context import validate_schema_name
from tenancy.provisioning import provision_tenant


REPO_ROOT = Path(__file__).resolve().parents[2]
DB_ENV_PATH = REPO_ROOT / "db" / ".env"
POSTGRES_HOST = "127.0.0.1"
# Puerto publicado por el servicio `postgres` de compose.yml, solo en loopback,
# para no chocar con otro PostgreSQL instalado en la máquina.
POSTGRES_PORT = 5433


def _read_db_env() -> dict[str, str]:
    values: dict[str, str] = {}
    if not DB_ENV_PATH.exists():
        return values
    for line in DB_ENV_PATH.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        values[key.strip()] = value.strip()
    return values


def _postgres_host_url() -> str | None:
    """Arma la URL de desarrollo apuntando al puerto publicado en el host.

    Las credenciales salen de ``db/.env`` (única fuente, según
    ``compose.yml``); el host/puerto son los que ese mismo archivo publica
    hacia loopback, no ``postgres:5432`` (solo resuelve dentro de la red de
    Docker, ver backend/.env que usa ese hostname para el contenedor backend).
    """

    values = _read_db_env()
    user = values.get("POSTGRES_USER")
    password = values.get("POSTGRES_PASSWORD")
    database = values.get("POSTGRES_DB")
    if not (user and password and database):
        return None
    return (
        f"postgresql+asyncpg://{quote(user)}:{quote(password)}"
        f"@{POSTGRES_HOST}:{POSTGRES_PORT}/{quote(database)}"
    )


def _postgres_reachable() -> bool:
    try:
        with socket.create_connection((POSTGRES_HOST, POSTGRES_PORT), timeout=1.0):
            return True
    except OSError:
        return False


@pytest.fixture
def pg_dsn() -> str:
    dsn = _postgres_host_url()
    if dsn is None:
        pytest.skip(f"no se pudieron leer credenciales de Postgres desde {DB_ENV_PATH}")
    if not _postgres_reachable():
        pytest.skip(
            "Postgres real de Docker no está accesible en "
            f"{POSTGRES_HOST}:{POSTGRES_PORT}; levantalo con "
            "`docker compose up -d postgres` antes de correr esta prueba"
        )
    return dsn


@pytest_asyncio.fixture
async def real_engine(pg_dsn, monkeypatch):
    """Apunta el engine global de db.session al Postgres real de Docker.

    ``pool_size=1`` / ``max_overflow=0`` fuerzan que solo exista una conexión
    física en el pool: cualquier secuencia de sesiones abiertas una tras otra
    (nunca concurrentes) tiene que reutilizarla, que es justo lo que el punto
    3.a de la tarea pide comprobar. ``database_ssl=disable`` reproduce el
    mismo override que compose.yml aplica al backend en desarrollo (el
    Postgres local no tiene TLS habilitado).
    """

    monkeypatch.setattr(settings, "database_url", pg_dsn)
    monkeypatch.setattr(settings, "database_ssl", "disable")
    monkeypatch.setattr(settings, "database_pool_size", 1)
    monkeypatch.setattr(settings, "database_max_overflow", 0)

    await close_engine()
    engine = get_engine()
    try:
        async with engine.connect() as connection:
            await connection.execute(text("SELECT 1"))
    except Exception as exc:  # pragma: no cover - diagnóstico de entorno
        await close_engine()
        pytest.skip(f"no se pudo abrir una conexión real contra Postgres: {exc}")
    try:
        yield engine
    finally:
        await close_engine()


@pytest_asyncio.fixture
async def tenant_pair(real_engine):
    """Aprovisiona dos tenants reales y efímeros, y los limpia al terminar."""

    suffix = secrets.token_hex(4)
    context_a = await provision_tenant(
        name=f"Integration Test A {suffix}",
        hostname=f"tenant-test-a-{suffix}.integration.test",
    )
    context_b = await provision_tenant(
        name=f"Integration Test B {suffix}",
        hostname=f"tenant-test-b-{suffix}.integration.test",
    )
    try:
        yield context_a, context_b
    finally:
        # DELETE explícito de los registros de control (cascada a
        # organization_domains / tenant_schema_versions) y DROP de los dos
        # schemas físicos: nada de esto debe sobrevivir a la prueba.
        async with control_session() as session:
            for context in (context_a, context_b):
                await session.execute(
                    text("DELETE FROM public.organizations WHERE id = :id"),
                    {"id": str(context.organization_id)},
                )
        async with real_engine.begin() as connection:
            for context in (context_a, context_b):
                schema = validate_schema_name(context.schema_name)
                await connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))


async def _add_user(session, *, email: str, name: str) -> int:
    user = User(
        email=email,
        name=name,
        password_hash="not-a-real-hash",
        role="vendedor",
        created_at=datetime.now(timezone.utc),
    )
    session.add(user)
    await session.flush()
    return user.id


@pytest.mark.asyncio
async def test_two_real_postgres_schemas_stay_isolated(tenant_pair) -> None:
    context_a, context_b = tenant_pair
    engine = get_engine()

    # ------------------------------------------------------------------
    # Sembrado: mismo email en A y en B (unicidad por schema, no global) y
    # una fila que solo existe en B para poder detectar una fuga real.
    # ------------------------------------------------------------------
    async with tenant_session(context_a) as session:
        user_a_id = await _add_user(session, email="colision@test.local", name="Usuario A")

    async with tenant_session(context_b) as session:
        user_b_collision_id = await _add_user(
            session, email="colision@test.local", name="Usuario B"
        )
        user_b_only_id = await _add_user(
            session, email="solo-en-b@test.local", name="Solo B"
        )

    # (b) Si la unicidad de `users.email` fuera global, el segundo insert
    # (mismo email, schema B) habría lanzado IntegrityError antes de llegar
    # acá. Además cada schema lleva su propia secuencia de id.
    assert user_a_id == 1
    assert user_b_collision_id == 1
    assert user_b_only_id != user_b_collision_id

    # ------------------------------------------------------------------
    # (a) Reutilización forzada de la misma conexión física en la secuencia
    # A -> B -> control (pool_size=1 en el fixture obliga a reciclarla).
    # ------------------------------------------------------------------
    checked_out_connections: list[int] = []

    def _on_checkout(dbapi_connection, connection_record, connection_proxy) -> None:
        checked_out_connections.append(id(dbapi_connection))

    event.listen(engine.sync_engine.pool, "checkout", _on_checkout)
    try:
        async with tenant_session(context_a) as session:
            path = (await session.execute(text("SHOW search_path"))).scalar_one()
            assert path.split(",")[0].strip() == context_a.schema_name
            # Lo único que existe en B, buscado con el search_path de A.
            leaked = (
                await session.execute(
                    select(User).where(User.email == "solo-en-b@test.local")
                )
            ).first()
            assert leaked is None

        async with tenant_session(context_b) as session:
            path = (await session.execute(text("SHOW search_path"))).scalar_one()
            assert path.split(",")[0].strip() == context_b.schema_name
            # Lo único que existe en A, buscado con el search_path de B.
            leaked = (
                await session.execute(select(User).where(User.name == "Usuario A"))
            ).first()
            assert leaked is None

        async with control_session() as session:
            path = (await session.execute(text("SHOW search_path"))).scalar_one()
            assert path == "public"
            # Si el search_path se hubiera quedado pegado al de un tenant, esta
            # búsqueda encontraría las filas que sembramos arriba.
            #
            # `users` solo existe en public mientras quede alguna instalación
            # single-tenant sin migrar: después del corte de la §11 las tablas
            # de negocio viven en el schema de cada negocio, y que la tabla ni
            # siquiera resuelva desde una sesión de control es una garantía más
            # fuerte que no encontrar filas.
            legacy_users_in_public = (
                await session.execute(text("SELECT to_regclass('public.users')"))
            ).scalar()
            if legacy_users_in_public is not None:
                leaked = (
                    await session.execute(
                        select(User).where(
                            User.email.in_(["colision@test.local", "solo-en-b@test.local"])
                        )
                    )
                ).first()
                assert leaked is None
    finally:
        event.remove(engine.sync_engine.pool, "checkout", _on_checkout)

    assert len(checked_out_connections) == 3
    assert len(set(checked_out_connections)) == 1, (
        "se esperaban 3 checkouts de la MISMA conexión física (pool_size=1); "
        "si esto falla, el pool entregó conexiones distintas y la secuencia "
        "A -> B -> control no ejercitó el caso de reutilización real"
    )

    # ------------------------------------------------------------------
    # (c) Un id real de una fila de B no se lee ni se actualiza desde una
    # sesión abierta con el contexto de A.
    # ------------------------------------------------------------------
    async with tenant_session(context_a) as session:
        # Mismo id de secuencia (1) que la fila de A: si hubiera fuga de
        # schema, esto devolvería los datos de B en vez de los de A.
        same_id_row = await session.get(User, user_b_collision_id)
        assert same_id_row is not None
        assert same_id_row.email == "colision@test.local"
        assert same_id_row.name == "Usuario A"

        # Id que solo existe en B: A no tiene ninguna fila con ese id.
        missing_row = await session.get(User, user_b_only_id)
        assert missing_row is None

        update_result = await session.execute(
            update(User).where(User.id == user_b_only_id).values(name="hijacked-from-a")
        )
        assert update_result.rowcount == 0

    async with tenant_session(context_b) as session:
        still_b = await session.get(User, user_b_only_id)
        assert still_b is not None
        assert still_b.name == "Solo B"

from contextlib import asynccontextmanager

from sqlalchemy import event, text
from sqlalchemy.orm import Session
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from config import settings
from request_metrics import install_db_timing
from tenancy.context import TenantContext, get_current_tenant, validate_schema_name

_engine: AsyncEngine | None = None
_sessionmaker: async_sessionmaker[AsyncSession] | None = None


class _TenantRoutingSyncSession(Session):
    """Session sync subyacente usada para aplicar el tenant en cada BEGIN."""


class TenantRoutingAsyncSession(AsyncSession):
    """AsyncSession que hereda el tenant activo sin cambiar 222 call sites."""

    sync_session_class = _TenantRoutingSyncSession


@event.listens_for(_TenantRoutingSyncSession, "after_begin")
def _apply_current_tenant_after_begin(session, transaction, connection) -> None:
    """Fija search_path al inicio de *cada* transacción.

    Es ``SET LOCAL`` mediante ``set_config(..., true)``: commit/rollback elimina
    el valor antes de devolver la conexión al pool. Si una sesión hace commit y
    vuelve a consultar, el siguiente BEGIN ejecuta este hook otra vez.
    """

    context = get_current_tenant()
    if context is None:
        return
    schema_name = validate_schema_name(context.schema_name)
    connection.execute(
        text("SELECT set_config('search_path', :search_path, true)"),
        {"search_path": f"{schema_name}, public"},
    )


def _to_async_url(url: str) -> str:
    """Normaliza el scheme al driver async de SQLAlchemy (postgresql+asyncpg)."""
    if url.startswith("postgresql+asyncpg://"):
        return url
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql+asyncpg://", 1)
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return url


def get_engine() -> AsyncEngine:
    global _engine
    if _engine is None:
        _engine = create_async_engine(
            _to_async_url(settings.database_url),
            connect_args={"ssl": settings.database_ssl, "timeout": 10},
            pool_pre_ping=settings.database_pool_pre_ping,
            pool_size=settings.database_pool_size,
            max_overflow=settings.database_max_overflow,
            pool_recycle=settings.database_pool_recycle_seconds,
        )
        install_db_timing(_engine)
    return _engine


def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    global _sessionmaker
    if _sessionmaker is None:
        _sessionmaker = async_sessionmaker(
            get_engine(), class_=TenantRoutingAsyncSession, expire_on_commit=False
        )
    return _sessionmaker


async def close_engine() -> None:
    global _engine, _sessionmaker
    if _engine is not None:
        await _engine.dispose()
    _engine = None
    _sessionmaker = None


async def _set_local_search_path(session: AsyncSession, search_path: str) -> None:
    # set_config recibe el path como valor, no como identificador SQL. El nombre
    # tenant ya pasó además por una lista cerrada antes de llegar aquí.
    await session.execute(
        text("SELECT set_config('search_path', :search_path, true)"),
        {"search_path": search_path},
    )


async def _transactional_session(search_path: str):
    session = get_sessionmaker()()
    try:
        async with session.begin():
            await _set_local_search_path(session, search_path)
            yield session
    finally:
        await session.close()


@asynccontextmanager
async def control_session():
    """Sesión transaccional limitada al plano de control ``public``."""

    async for session in _transactional_session("public"):
        yield session


@asynccontextmanager
async def tenant_session(context: TenantContext):
    """Sesión transaccional con el schema tenant primero en ``search_path``."""

    current = get_current_tenant()
    if current is not None and current.organization_id != context.organization_id:
        raise RuntimeError("cannot open a different tenant inside the current context")
    schema_name = validate_schema_name(context.schema_name)
    # El formato cerrado no necesita quoting y evita depender de interpolación
    # de identificadores, que PostgreSQL no admite como parámetros de valor.
    async for session in _transactional_session(f"{schema_name}, public"):
        yield session

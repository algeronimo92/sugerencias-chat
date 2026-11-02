"""Unidad de trabajo: una transacción por caso de uso.

Antes cada función de repositorio abría su propia sesión y hacía su commit,
así que un caso de uso que tocaba dos módulos no era atómico. Ahora el caso
de uso abre la unidad de trabajo y todo lo que corre adentro comparte sesión
y transacción. Vive en un ``ContextVar``, igual que el tenant
(``app.tenancy.context``): no hay que pasar la sesión de mano en mano y la
sesión ya fija el ``search_path`` del tenant en cada ``BEGIN``
(``app.db.session.TenantRoutingAsyncSession``).

La unidad de trabajo también junta los eventos de dominio y los despacha en
sus dos fases (``app.core.events``): los de ``transaction`` antes del commit y
los de ``after_commit`` solo si el commit ocurrió.

``session_scope`` es la puerta para los repositorios: se suma a la unidad de
trabajo activa o, si no hay ninguna, abre una sesión propia y confirma al
salir, como hacían antes. Así se migran de a uno sin romper a los que todavía
se llaman fuera de un caso de uso.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from contextvars import ContextVar

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.events import DomainEvent, dispatch_after_commit, dispatch_in_transaction, set_unit_of_work_probe
from app.db.session import get_sessionmaker


class UnitOfWork:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.events: list[DomainEvent] = []

    def collect(self, *events: DomainEvent) -> None:
        self.events.extend(events)


_current: ContextVar[UnitOfWork | None] = ContextVar("unit_of_work", default=None)
set_unit_of_work_probe(lambda: _current.get() is not None)


def current_unit_of_work() -> UnitOfWork | None:
    return _current.get()


def current_session() -> AsyncSession:
    """La sesión del caso de uso en curso. Falla si no hay ninguno abierto:
    un repositorio que la pide fuera de un caso de uso es un error de cableado."""
    uow = _current.get()
    if uow is None:
        raise RuntimeError("No hay una unidad de trabajo activa")
    return uow.session


def collect(*events: DomainEvent) -> None:
    """Registra eventos en la unidad de trabajo activa."""
    uow = _current.get()
    if uow is None:
        raise RuntimeError("No hay una unidad de trabajo activa para registrar eventos")
    uow.collect(*events)


@asynccontextmanager
async def unit_of_work() -> AsyncIterator[UnitOfWork]:
    """Abre la transacción del caso de uso. Anidada, se suma a la externa: el
    commit y los eventos quedan a cargo de la unidad de trabajo más externa."""
    outer = _current.get()
    if outer is not None:
        yield outer
        return

    session = get_sessionmaker()()
    uow = UnitOfWork(session)
    token = _current.set(uow)
    try:
        async with session.begin():
            yield uow
            await dispatch_in_transaction(uow.events)
    finally:
        _current.reset(token)
        await session.close()
    await dispatch_after_commit(uow.events)


@asynccontextmanager
async def session_scope() -> AsyncIterator[AsyncSession]:
    """Sesión para un repositorio: la del caso de uso en curso, o una propia
    que se confirma al salir sin error. Dentro, el repositorio no hace commit."""
    uow = _current.get()
    if uow is not None:
        yield uow.session
        return
    async with get_sessionmaker()() as session:
        yield session
        await session.commit()

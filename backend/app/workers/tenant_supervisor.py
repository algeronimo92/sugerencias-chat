"""Un ciclo por tipo de worker que recorre los negocios activos.

Antes había una tarea infinita por worker y por negocio: con N negocios y
seis workers, 6 × N tareas sondeando la base cada pocos segundos. Ahora cada
worker es una pasada (``tick``) que el ciclo corre dentro del contexto de
cada negocio y después espera (``idle``): su sondeo de respaldo o la señal
que lo despierta.

Cada negocio avanza por su cuenta: su próxima pasada arranca apenas termina
la anterior (si dejó trabajo) o cuando el worker despierta, sin esperar a los
demás. Un negocio cuyo proveedor tarda (un lote de outbox puede esperar a
Meta hasta 90 s) solo se demora a sí mismo. Cada negocio tiene a lo sumo una
pasada en curso y hay hasta ``concurrency`` corriendo a la vez.

Cuando un negocio deja de estar activo, ``forget`` le avisa al worker para
que suelte lo que recordaba de él (un cursor, un temporizador): si vuelve a
activarse, arranca de cero como lo haría una tarea nueva.

Cada pasada abre su propio ``tenant_context``: la sesión, la configuración y
las credenciales no se arrastran de un negocio al siguiente. Si la pasada de
un negocio falla se registra y el ciclo sigue con los demás.

Una pasada que devuelve True dejó trabajo pendiente (p. ej. la outbox tomó un
lote): ese negocio vuelve a correr enseguida. El semáforo reparte los turnos,
así ninguno acapara al worker.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from time import monotonic

from app.tenancy.context import TenantContext, tenant_context
from app.tenancy.resolver import list_active_tenants

logger = logging.getLogger(__name__)

Tick = Callable[[], Awaitable[bool | None]]
Idle = Callable[[], Awaitable[None]]
TenantSource = Callable[[], Awaitable[Sequence[TenantContext | None]]]


Forget = Callable[[object], None]


@dataclass(frozen=True, slots=True)
class TenantLoop:
    name: str
    tick: Tick
    idle: Idle
    forget: Forget | None = None
    concurrency: int = 8


def tenant_key(context: TenantContext | None) -> object:
    return context.organization_id if context is not None else None


def sleeping(seconds: float) -> Idle:
    async def idle() -> None:
        await asyncio.sleep(seconds)

    return idle


async def single_tenant() -> Sequence[None]:
    """Instalación sin multitenancy: una sola pasada sin contexto."""
    return [None]


class CachedTenants:
    """La lista de negocios activos se relee cada ``refresh_seconds``: incorpora
    altas y suspensiones sin consultar el plano de control en cada ronda."""

    def __init__(self, refresh_seconds: float = 30.0, source: TenantSource | None = None) -> None:
        self.refresh_seconds = refresh_seconds
        self.source = source or list_active_tenants
        self._tenants: Sequence[TenantContext | None] = ()
        self._expires_at = 0.0

    async def __call__(self) -> Sequence[TenantContext | None]:
        if monotonic() >= self._expires_at:
            self._tenants = await self.source()
            self._expires_at = monotonic() + self.refresh_seconds
        return self._tenants


async def run_tick(loop: TenantLoop, context: TenantContext | None) -> bool:
    """Una pasada del worker para un negocio, en su propio contexto."""
    scope = tenant_context(context) if context is not None else contextlib.nullcontext()
    with scope:
        try:
            return bool(await loop.tick())
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception(
                "Falló la pasada de %s para organization_id=%s",
                loop.name, getattr(context, "organization_id", None),
            )
            return False


async def run_tenant_loop(loop: TenantLoop, tenants: TenantSource) -> None:
    semaphore = asyncio.Semaphore(max(1, loop.concurrency))
    running: dict[object, asyncio.Task] = {}
    known: set[object] = set()
    # None: a todos les toca una pasada (arranque o despertador); si no, solo
    # a los que dejaron trabajo pendiente.
    due: set[object] | None = None
    idle_task: asyncio.Task | None = None

    async def bounded(context: TenantContext | None) -> bool:
        async with semaphore:
            return await run_tick(loop, context)

    try:
        while True:
            try:
                contexts = {tenant_key(context): context for context in await tenants()}
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("No se pudo leer la lista de negocios para %s", loop.name)
                contexts = {}
            if loop.forget is not None:
                for key in known - set(contexts):
                    loop.forget(key)
            known = set(contexts)

            for key, context in contexts.items():
                if key not in running and (due is None or key in due):
                    running[key] = asyncio.create_task(bounded(context), name=f"{loop.name}:{key}")
            due = set()

            if idle_task is None:
                idle_task = asyncio.create_task(loop.idle(), name=f"{loop.name}:idle")
            done, _pending = await asyncio.wait([idle_task, *running.values()], return_when=asyncio.FIRST_COMPLETED)

            if idle_task in done:
                idle_task = None
                due = None
            for key, task in list(running.items()):
                if task.done():
                    running.pop(key)
                    if task.result() and due is not None:
                        due.add(key)
    finally:
        for task in [*running.values(), *([idle_task] if idle_task else [])]:
            task.cancel()
        for task in [*running.values(), *([idle_task] if idle_task else [])]:
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await task

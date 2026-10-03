"""Un ciclo por tipo de worker que recorre los negocios activos.

Antes había una tarea infinita por worker y por negocio: con N negocios y
seis workers, 6 × N tareas sondeando la base cada pocos segundos. Ahora cada
worker es una pasada (``tick``) que el ciclo corre dentro del contexto de
cada negocio, uno tras otro, y después espera (``idle``): su sondeo de
respaldo o la señal que lo despierta.

Cada pasada abre su propio ``tenant_context``: la sesión, la configuración y
las credenciales no se arrastran de un negocio al siguiente. Si la pasada de
un negocio falla se registra y el ciclo sigue con los demás.

Una pasada que devuelve True dejó trabajo pendiente (p. ej. la outbox tomó un
lote completo): el ciclo vuelve a recorrer los negocios sin esperar, así
cada uno avanza un lote por ronda y ninguno acapara al worker.
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


@dataclass(frozen=True, slots=True)
class TenantLoop:
    name: str
    tick: Tick
    idle: Idle


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
    while True:
        try:
            busy = False
            for context in await tenants():
                busy = await run_tick(loop, context) or busy
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Falló el ciclo de %s", loop.name)
            busy = False
        if not busy:
            await loop.idle()

"""Supervisión de workers infinitos por tenant activo.

Cada tarea obtiene su propio ContextVar antes de tocar DB, settings, WhatsApp,
media o WebSocket. Esto evita que un cursor, una sesión o una credencial se
reutilicen accidentalmente para el siguiente negocio.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass

from tenancy.context import TenantContext, tenant_context
from tenancy.resolver import list_active_tenants


logger = logging.getLogger(__name__)
Worker = Callable[[], Awaitable[None]]


@dataclass(frozen=True, slots=True)
class WorkerSpec:
    name: str
    run: Worker


async def _run_for_tenant(context: TenantContext, spec: WorkerSpec) -> None:
    with tenant_context(context):
        try:
            await spec.run()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception(
                "Worker %s terminó para organization_id=%s",
                spec.name,
                context.organization_id,
            )
            raise


async def supervise_tenant_workers(
    specs: Sequence[WorkerSpec],
    *,
    refresh_seconds: float = 30.0,
) -> None:
    """Mantiene una tarea de cada tipo para cada organización activa.

    La lista se relee para incorporar altas y suspensiones sin reiniciar. Una
    tarea caída se vuelve a crear en la siguiente vuelta; no puede arrastrar el
    contexto porque cada runner vive en su propia tarea de asyncio.
    """

    tasks: dict[tuple[str, str], tuple[TenantContext, asyncio.Task]] = {}
    try:
        while True:
            tenants = await list_active_tenants()
            active = {str(context.organization_id): context for context in tenants}

            for key, (_context, task) in list(tasks.items()):
                organization_id, _worker_name = key
                if organization_id not in active or task.done():
                    if not task.done():
                        task.cancel()
                    with contextlib.suppress(asyncio.CancelledError, Exception):
                        await task
                    tasks.pop(key, None)

            for organization_id, context in active.items():
                for spec in specs:
                    key = (organization_id, spec.name)
                    if key in tasks:
                        continue
                    task = asyncio.create_task(
                        _run_for_tenant(context, spec),
                        name=f"tenant:{organization_id}:{spec.name}",
                    )
                    tasks[key] = (context, task)

            await asyncio.sleep(refresh_seconds)
    finally:
        for _context, task in tasks.values():
            task.cancel()
        for _context, task in tasks.values():
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await task

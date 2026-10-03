"""Un ciclo por tipo de worker que recorre los negocios."""

import asyncio
from uuid import uuid4

import pytest

from app.tenancy.context import TenantContext, get_current_tenant
from app.workers.tenant_supervisor import CachedTenants, TenantLoop, run_tenant_loop, run_tick


def _tenant(name: str) -> TenantContext:
    return TenantContext(uuid4(), f"tenant_{uuid4().hex}", f"{name}.example.test")


class _Stop(Exception):
    pass


async def test_each_pass_runs_in_its_own_tenant_context() -> None:
    context = _tenant("a")
    observed = []

    async def tick():
        observed.append(get_current_tenant())

    await run_tick(TenantLoop("once", tick, None), context)

    assert observed == [context]
    assert get_current_tenant() is None


async def test_a_failing_tenant_does_not_stop_the_others() -> None:
    tenants = [_tenant("a"), _tenant("b")]
    seen = []

    async def tick():
        seen.append(get_current_tenant().organization_id)
        if get_current_tenant() is tenants[0]:
            raise RuntimeError("negocio roto")

    async def idle():
        raise _Stop

    async def source():
        return tenants

    with pytest.raises(_Stop):
        await run_tenant_loop(TenantLoop("round", tick, idle), source)

    assert seen == [tenant.organization_id for tenant in tenants]


async def test_pending_work_skips_the_wait() -> None:
    """Una pasada que dejó trabajo pendiente vuelve a recorrer los negocios
    sin esperar: cada uno avanza un lote por ronda."""
    tenants = [_tenant("a"), _tenant("b")]
    batches = {tenant.organization_id: 2 for tenant in tenants}
    rounds = []

    async def tick():
        key = get_current_tenant().organization_id
        if batches[key]:
            batches[key] -= 1
            rounds.append(key)
            return True
        return False

    async def idle():
        raise _Stop

    async def source():
        return tenants

    with pytest.raises(_Stop):
        await run_tenant_loop(TenantLoop("outbox", tick, idle), source)

    a, b = (tenant.organization_id for tenant in tenants)
    assert rounds == [a, b, a, b]


async def test_the_tenant_list_is_reread_only_after_it_expires() -> None:
    calls = []

    async def source():
        calls.append(1)
        return [_tenant("a")]

    tenants = CachedTenants(refresh_seconds=60.0, source=source)
    await tenants()
    await tenants()

    assert len(calls) == 1


async def test_two_tenants_never_share_context_concurrently() -> None:
    tenants = [_tenant("a"), _tenant("b")]
    ready = asyncio.Event()
    observed = []

    async def tick():
        observed.append(get_current_tenant())
        if len(observed) == 2:
            ready.set()
        await ready.wait()

    loop = TenantLoop("parallel", tick, None)
    await asyncio.gather(*(run_tick(loop, context) for context in tenants))

    assert {item.organization_id for item in observed} == {context.organization_id for context in tenants}

"""Un ciclo por tipo de worker que recorre los negocios."""

import asyncio
from uuid import uuid4

from app.tenancy.context import TenantContext, get_current_tenant
from app.workers.tenant_supervisor import CachedTenants, TenantLoop, run_tenant_loop, run_tick


def _tenant(name: str) -> TenantContext:
    return TenantContext(uuid4(), f"tenant_{uuid4().hex}", f"{name}.example.test")


async def _run_until(loop: TenantLoop, tenants, condition, timeout: float = 2.0) -> None:
    task = asyncio.create_task(run_tenant_loop(loop, tenants))
    try:
        async with asyncio.timeout(timeout):
            while not condition():
                await asyncio.sleep(0.01)
    finally:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


def _source(contexts):
    async def source():
        return list(contexts)

    return source


async def _short_idle():
    await asyncio.sleep(0.02)


async def test_each_pass_runs_in_its_own_tenant_context() -> None:
    context = _tenant("a")
    observed = []

    async def tick():
        observed.append(get_current_tenant())

    await run_tick(TenantLoop("once", tick, _short_idle), context)

    assert observed == [context]
    assert get_current_tenant() is None


async def test_a_slow_tenant_does_not_hold_back_the_others() -> None:
    """Mientras el negocio A espera a su proveedor, B sigue haciendo pasadas."""
    slow, fast = _tenant("slow"), _tenant("fast")
    release = asyncio.Event()
    passes = {slow.organization_id: 0, fast.organization_id: 0}

    async def tick():
        key = get_current_tenant().organization_id
        passes[key] += 1
        if key == slow.organization_id:
            await release.wait()

    await _run_until(
        TenantLoop("outbox", tick, _short_idle), _source([slow, fast]),
        lambda: passes[fast.organization_id] >= 3,
    )
    release.set()

    assert passes[slow.organization_id] == 1


async def test_a_failing_tenant_does_not_stop_the_others() -> None:
    broken, healthy = _tenant("broken"), _tenant("healthy")
    passes = []

    async def tick():
        passes.append(get_current_tenant().organization_id)
        if get_current_tenant() is broken:
            raise RuntimeError("negocio roto")

    await _run_until(
        TenantLoop("round", tick, _short_idle), _source([broken, healthy]),
        lambda: passes.count(healthy.organization_id) >= 2,
    )

    assert passes.count(broken.organization_id) >= 1


async def test_pending_work_runs_again_without_waiting() -> None:
    """Una pasada que dejó trabajo vuelve enseguida, aunque el despertador
    tarde: la outbox no espera un sondeo entre lote y lote."""
    tenant = _tenant("a")
    batches = [True, True, True, False]

    async def tick():
        return batches.pop(0) if batches else False

    async def never():
        await asyncio.sleep(3600)

    await _run_until(TenantLoop("outbox", tick, never), _source([tenant]), lambda: not batches)


async def test_a_tenant_that_leaves_is_forgotten() -> None:
    staying, leaving = _tenant("staying"), _tenant("leaving")
    contexts = [staying, leaving]
    forgotten = []

    async def tick():
        return None

    async def source():
        return list(contexts)

    async def idle():
        contexts[:] = [staying]
        await asyncio.sleep(0.02)

    await _run_until(
        TenantLoop("chats", tick, idle, forgotten.append), source, lambda: forgotten,
    )

    assert forgotten == [leaving.organization_id]


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

    loop = TenantLoop("parallel", tick, _short_idle)
    await asyncio.gather(*(run_tick(loop, context) for context in tenants))

    assert {item.organization_id for item in observed} == {context.organization_id for context in tenants}

import asyncio
from uuid import uuid4

import pytest

from app.workers import tenant_supervisor as tenant_workers
from app.workers.tenant_supervisor import WorkerSpec
from app.tenancy.context import TenantContext, get_current_tenant


def _tenant(name: str) -> TenantContext:
    return TenantContext(uuid4(), f"tenant_{uuid4().hex}", f"{name}.example.test")


@pytest.mark.asyncio
async def test_worker_runs_with_its_own_tenant_context() -> None:
    context = _tenant("a")
    observed = []

    async def worker():
        observed.append(get_current_tenant())

    await tenant_workers._run_for_tenant(context, WorkerSpec("once", worker))
    assert observed == [context]
    assert get_current_tenant() is None


@pytest.mark.asyncio
async def test_workers_for_two_tenants_do_not_share_context() -> None:
    tenants = [_tenant("a"), _tenant("b")]
    ready = asyncio.Event()
    observed = []

    async def worker():
        observed.append(get_current_tenant())
        if len(observed) == 2:
            ready.set()
        await ready.wait()

    await asyncio.gather(*(
        tenant_workers._run_for_tenant(context, WorkerSpec("parallel", worker))
        for context in tenants
    ))

    assert {item.organization_id for item in observed} == {
        context.organization_id for context in tenants
    }

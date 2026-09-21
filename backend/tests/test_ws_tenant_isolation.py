from uuid import uuid4

import pytest

from services.ws_manager import ConnectionManager
from tenancy.context import TenantContext, tenant_context


class FakeWebSocket:
    def __init__(self) -> None:
        self.accepted = False
        self.messages: list[dict] = []
        self.closed = False

    async def accept(self) -> None:
        self.accepted = True

    async def send_json(self, message: dict) -> None:
        self.messages.append(message)

    async def close(self) -> None:
        self.closed = True


def _tenant(name: str) -> TenantContext:
    return TenantContext(
        organization_id=uuid4(),
        schema_name=f"tenant_{uuid4().hex}",
        hostname=f"{name}.cliniventas.test",
    )


@pytest.mark.asyncio
async def test_broadcast_only_reaches_current_tenant() -> None:
    manager = ConnectionManager()
    tenant_a = _tenant("a")
    tenant_b = _tenant("b")
    socket_a = FakeWebSocket()
    socket_b = FakeWebSocket()

    with tenant_context(tenant_a):
        await manager.connect(socket_a, user_id=1)
    with tenant_context(tenant_b):
        await manager.connect(socket_b, user_id=1)
    with tenant_context(tenant_a):
        await manager.broadcast({"type": "chats_updated"})

    assert socket_a.messages == [{"type": "chats_updated"}]
    assert socket_b.messages == []


@pytest.mark.asyncio
async def test_direct_message_scopes_repeated_user_ids_by_tenant() -> None:
    manager = ConnectionManager()
    tenant_a = _tenant("a")
    tenant_b = _tenant("b")
    socket_a = FakeWebSocket()
    socket_b = FakeWebSocket()

    await manager.connect(socket_a, user_id=7, organization_id=tenant_a.organization_id)
    await manager.connect(socket_b, user_id=7, organization_id=tenant_b.organization_id)

    delivered = await manager.send_to_user(
        7,
        {"type": "task_reminder"},
        organization_id=tenant_b.organization_id,
    )

    assert delivered is True
    assert socket_a.messages == []
    assert socket_b.messages == [{"type": "task_reminder"}]


@pytest.mark.asyncio
async def test_disconnect_organization_closes_only_that_tenants_sockets() -> None:
    """Al suspender un negocio hay que cortar lo que ya estaba conectado, no
    solo dejar de aceptar conexiones nuevas -- ver
    `tenancy/provisioning.suspend_organization`."""
    manager = ConnectionManager()
    tenant_a = _tenant("a")
    tenant_b = _tenant("b")
    socket_a = FakeWebSocket()
    socket_b = FakeWebSocket()

    with tenant_context(tenant_a):
        await manager.connect(socket_a, user_id=1)
    with tenant_context(tenant_b):
        await manager.connect(socket_b, user_id=2)

    await manager.disconnect_organization(tenant_a.organization_id)

    assert socket_a.closed is True
    assert socket_b.closed is False
    assert await manager.connection_count() == 1


@pytest.mark.asyncio
async def test_legacy_connections_remain_isolated_from_tenant_connections() -> None:
    manager = ConnectionManager()
    tenant = _tenant("tenant")
    legacy_socket = FakeWebSocket()
    tenant_socket = FakeWebSocket()

    await manager.connect(legacy_socket, user_id=1)
    await manager.connect(
        tenant_socket,
        user_id=1,
        organization_id=tenant.organization_id,
    )
    await manager.broadcast({"type": "legacy"})

    assert legacy_socket.messages == [{"type": "legacy"}]
    assert tenant_socket.messages == []

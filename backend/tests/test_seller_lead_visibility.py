"""Ajuste "cada vendedor ve solo sus leads asignados" (leads/visibility.py).

Se prueba en las tres capas donde se aplica: listas (``LeadFilters.owner_id``),
rutas que reciben un lead por id y avisos en tiempo real. Si una capa queda
fuera, el vendedor ve en una lo que la otra le esconde.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi.routing import APIRoute

import main
from app.modules.leads import api as leads_api
from app.modules.leads import visibility
from app.modules.leads.domain.errors import LeadNotFound
from app.modules.leads.schemas import LeadCreate
from app.modules.platform import settings_service
from app.realtime.ws_manager import ConnectionManager
from tests.permission_fakes import use_role_matrix

ADMIN = SimpleNamespace(id=1, role="admin")
ANA = SimpleNamespace(id=7, role="vendedor")
BEA = SimpleNamespace(id=8, role="vendedor")


@pytest.fixture
def restricted(monkeypatch):
    """Ajuste encendido; ``sellers`` es el vendedor de cada lead existente."""
    use_role_matrix(monkeypatch, sellers_see_all=False)
    sellers = {"lead-ana": 7, "lead-bea": 8, "lead-libre": None}

    async def fetch(lead_ids):
        return {lead_id: sellers[lead_id] for lead_id in lead_ids if lead_id in sellers}

    monkeypatch.setattr(visibility, "fetch_lead_sellers", fetch)
    return sellers


@pytest.fixture
def unrestricted(monkeypatch):
    use_role_matrix(monkeypatch)
    fetch = AsyncMock(side_effect=AssertionError("sin el ajuste no se consulta el lead"))
    monkeypatch.setattr(visibility, "fetch_lead_sellers", fetch)


# --- A quién se acota ------------------------------------------------------

async def test_with_the_setting_off_everyone_sees_every_lead(unrestricted):
    assert await visibility.seller_scope(ANA) is None
    await visibility.ensure_lead_visible(ANA, "lead-bea")
    assert await visibility.visible_lead_ids(ANA, ["lead-bea", "lead-libre"]) == {"lead-bea", "lead-libre"}
    assert await visibility.lead_audience("lead-bea") is None


async def test_admins_always_see_every_lead(restricted):
    assert await visibility.seller_scope(ADMIN) is None
    await visibility.ensure_lead_visible(ADMIN, "lead-bea")


async def test_a_restricted_seller_only_reaches_her_own_leads(restricted):
    assert await visibility.seller_scope(ANA) == 7
    await visibility.ensure_lead_visible(ANA, "lead-ana")
    with pytest.raises(LeadNotFound):
        await visibility.ensure_lead_visible(ANA, "lead-bea")
    # Sin asignar tampoco: los reparte un administrador.
    with pytest.raises(LeadNotFound):
        await visibility.ensure_lead_visible(ANA, "lead-libre")
    assert await visibility.visible_lead_ids(ANA, ["lead-ana", "lead-bea", "no-existe"]) == {"lead-ana"}


async def test_a_missing_lead_is_left_to_the_route_404(restricted):
    await visibility.ensure_lead_visible(ANA, "no-existe")


@pytest.mark.parametrize(("path_params", "query_params"), [
    ({"chat_id": "lead-bea"}, {}),
    ({"lead_id": "lead-bea"}, {}),
    ({}, {"chat_id": "lead-bea"}),
])
async def test_the_router_guard_reads_the_lead_from_path_or_query(restricted, path_params, query_params):
    request = SimpleNamespace(path_params=path_params, query_params=query_params)
    with pytest.raises(LeadNotFound):
        await visibility.require_visible_lead(request, ANA)
    await visibility.require_visible_lead(request, BEA)


async def test_the_router_guard_ignores_routes_without_a_lead(restricted):
    await visibility.require_visible_lead(SimpleNamespace(path_params={}, query_params={}), ANA)


def test_every_route_that_takes_a_lead_by_id_is_guarded():
    """Una ruta nueva bajo ``/{chat_id}`` que no pase por el guard dejaría a un
    vendedor acotado leer el chat de otro."""
    def guarded(dependant) -> bool:
        return any(dep.call is visibility.require_visible_lead or guarded(dep) for dep in dependant.dependencies)

    unguarded = sorted(
        f"{sorted(route.methods)} {route.path}"
        for route in main.app.routes
        if isinstance(route, APIRoute)
        and ("{chat_id}" in route.path or "{lead_id}" in route.path)
        and not guarded(route.dependant)
    )
    assert unguarded == []


# --- Tiempo real -----------------------------------------------------------

async def test_message_notices_reach_only_the_lead_seller_and_admins(restricted):
    assert await visibility.lead_audience("lead-ana") == frozenset({7})
    assert await visibility.lead_audience("lead-libre") == frozenset()


async def test_calls_ring_for_admins_and_the_lead_seller(restricted, monkeypatch):
    agents = [{"id": 1, "role": "admin"}, {"id": 7, "role": "vendedor"}, {"id": 8, "role": "vendedor"}]
    monkeypatch.setattr(visibility, "list_call_agents", AsyncMock(return_value=agents))
    assert [agent["id"] for agent in await visibility.call_agents_for("lead-ana")] == [1, 7]


async def test_a_call_never_falls_back_to_an_unrelated_seller(restricted, monkeypatch):
    agents = [{"id": 8, "role": "vendedor"}]
    monkeypatch.setattr(visibility, "list_call_agents", AsyncMock(return_value=agents))
    assert await visibility.call_agents_for("lead-ana") == []


class FakeWebSocket:
    def __init__(self) -> None:
        self.messages: list[dict] = []

    async def accept(self) -> None:
        pass

    async def send_json(self, message: dict) -> None:
        self.messages.append(message)

    async def close(self) -> None:
        pass


async def test_a_scoped_broadcast_skips_other_sellers_but_not_admins():
    manager = ConnectionManager()
    admin, ana, bea = FakeWebSocket(), FakeWebSocket(), FakeWebSocket()
    await manager.connect(admin, 1)
    await manager.connect(ana, 7, is_seller=True)
    await manager.connect(bea, 8, is_seller=True)

    await manager.broadcast({"type": "chats_updated", "chat_id": "lead-ana"}, sellers=frozenset({7}))
    await manager.broadcast({"type": "chats_updated", "chat_id": "lead-libre"}, sellers=frozenset())
    await manager.broadcast({"type": "tasks_updated"})

    assert [m.get("chat_id") for m in admin.messages] == ["lead-ana", "lead-libre", None]
    assert [m.get("chat_id") for m in ana.messages] == ["lead-ana", None]
    assert [m.get("chat_id") for m in bea.messages] == [None]


# --- Listas y alta ---------------------------------------------------------

async def test_inbox_filters_carry_the_seller_scope(restricted):
    filters = await leads_api._lead_filters(user=ANA)
    assert filters.owner_id == 7
    assert (await leads_api._lead_filters(user=ADMIN)).owner_id is None


async def test_a_restricted_seller_owns_the_lead_she_creates_without_an_assignment(in_memory_leads, restricted, monkeypatch):
    monkeypatch.setattr(leads_api, "effective_country_code", AsyncMock(return_value="51"))
    monkeypatch.setattr(leads_api, "fetch_chat", AsyncMock(side_effect=lambda chat_id: {"chat_id": chat_id}))
    monkeypatch.setattr(leads_api, "normalize_values", AsyncMock(return_value={}))

    result = await leads_api.create_chat(LeadCreate(phone="51987654321", name="Ana"), ANA)

    assert in_memory_leads.repository.column(result["chat_id"], "vendedor_id") == 7


async def test_the_setting_only_accepts_true_or_false(monkeypatch):
    monkeypatch.setattr(settings_service.settings_repository, "upsert_values", AsyncMock())
    with pytest.raises(ValueError):
        await settings_service.update_settings({"sellers_see_only_assigned_leads": "quizas"})
    await settings_service.update_settings({"sellers_see_only_assigned_leads": " TRUE "})
    settings_service.settings_repository.upsert_values.assert_awaited_once_with(
        {"sellers_see_only_assigned_leads": "true"}
    )


async def test_mentions_only_reach_people_who_can_open_the_lead(restricted, monkeypatch):
    from app.modules.notifications import subscribers
    staff = [{"id": 1, "role": "admin"}, {"id": 7, "role": "vendedor"}, {"id": 8, "role": "vendedor"}]
    monkeypatch.setattr(visibility, "list_active_sellers", AsyncMock(return_value=staff))
    create = AsyncMock(return_value=[])
    monkeypatch.setattr(subscribers, "create_mention_notifications", create)
    await subscribers.notify_mentions(SimpleNamespace(
        chat_id="lead-ana", note={"id": 4, "lead_id": "lead-ana", "content": "privado"},
        user_ids=(1, 7, 8), author_id=1, author_name="Admin",
    ))
    assert create.await_args.args[1] == [1, 7]


async def test_changing_the_setting_refreshes_open_screens(monkeypatch):
    from app.modules.platform import settings_api
    from app.modules.platform.schemas import UpdateSettingsRequest
    save, notify, grant = AsyncMock(), AsyncMock(), AsyncMock()
    use_role_matrix(monkeypatch)
    monkeypatch.setattr(settings_api, "update_settings", save)
    monkeypatch.setattr(settings_api, "lead_visibility_changed", notify)
    monkeypatch.setattr(settings_api, "set_role_permission", grant)
    monkeypatch.setattr(settings_api, "list_settings", AsyncMock(return_value=[]))
    for value in ("true", "false"):
        await settings_api.put_settings(UpdateSettingsRequest(values={"sellers_see_only_assigned_leads": value}))
    assert notify.await_count == 2
    # El interruptor escribe sobre la matriz: encendido le quita al vendedor
    # ``leads.view_all``, apagado se lo devuelve.
    assert [call.kwargs["granted"] for call in grant.await_args_list] == [False, True]
    assert all(call.args == ("vendedor", "leads.view_all") for call in grant.await_args_list)


async def test_the_setting_shows_what_the_matrix_says(monkeypatch):
    from app.modules.platform import settings_api
    item = {"key": "sellers_see_only_assigned_leads", "value": "false", "configured": False}
    monkeypatch.setattr(settings_api, "list_settings", AsyncMock(return_value=[item]))
    use_role_matrix(monkeypatch, sellers_see_all=False)
    assert (await settings_api.get_settings())[0]["value"] == "true"
    use_role_matrix(monkeypatch)
    assert (await settings_api.get_settings())[0]["value"] == "false"


async def test_a_reassignment_refreshes_the_previous_seller_without_leaking_the_lead(monkeypatch):
    from app.modules.leads import subscribers
    broadcast = AsyncMock()
    monkeypatch.setattr(subscribers.manager, "broadcast", broadcast)
    monkeypatch.setattr(subscribers, "lead_audience", AsyncMock(return_value=frozenset({8})))
    await subscribers.lead_updated(SimpleNamespace(fields=("vendedor_id",), event_type="lead_updated", lead_id="lead-bea"))
    broadcast.assert_awaited_once_with({"type": "lead_visibility_changed"})


async def test_foreign_automation_cannot_be_paused_or_cancelled(restricted, monkeypatch):
    from app.modules.automations import api
    monkeypatch.setattr(api, "get_automation_execution", AsyncMock(return_value={"lead_id": "lead-bea"}))
    for operation in (api.post_cancel_execution, api.post_pause_execution, api.post_resume_execution):
        with pytest.raises(LeadNotFound):
            await operation(1, ANA)


async def test_reassigned_scheduled_message_cannot_be_cancelled(restricted, monkeypatch):
    from app.modules.conversations import scheduled_messages_api as api
    monkeypatch.setattr(api, "scheduled_lead_id", AsyncMock(return_value="lead-bea"))
    cancel = AsyncMock()
    monkeypatch.setattr(api, "cancel_scheduled_message", cancel)
    with pytest.raises(LeadNotFound):
        await api.delete_scheduled_message(1, ANA)
    cancel.assert_not_awaited()


async def test_foreign_lead_cannot_get_a_task_or_appointment(restricted, monkeypatch):
    from datetime import datetime, timezone
    from app.modules.tasks import api as tasks
    from app.modules.tasks.schemas import TaskCreate
    from app.modules.appointments import api as appointments
    from tests.test_appointment_from_lead import _body
    create = AsyncMock()
    monkeypatch.setattr(tasks, "create_task", create)
    with pytest.raises(LeadNotFound):
        await tasks.post_task(TaskCreate(lead_id="lead-bea", title="Llamar", due_at=datetime.now(timezone.utc)), ANA)
    with pytest.raises(LeadNotFound):
        # El esquema de citas exige un UUID: el mapa representa ese lead ajeno.
        lead_id = "6f1c2e3a-0b4d-4c5e-8f9a-1b2c3d4e5f60"
        monkeypatch.setattr(visibility, "fetch_lead_sellers", AsyncMock(return_value={lead_id: 8}))
        await appointments.post_appointment(_body(), ANA)
    create.assert_not_awaited()


async def test_remote_broadcast_keeps_the_seller_and_tenant_scope(monkeypatch):
    from uuid import uuid4
    from app.realtime import ws_manager
    manager = ConnectionManager()
    tenant_a, tenant_b = uuid4(), uuid4()
    own, foreign, other_tenant = FakeWebSocket(), FakeWebSocket(), FakeWebSocket()
    await manager.connect(own, 7, tenant_a, is_seller=True)
    await manager.connect(foreign, 8, tenant_a, is_seller=True)
    await manager.connect(other_tenant, 7, tenant_b, is_seller=True)
    monkeypatch.setattr(ws_manager, "manager", manager)
    await ws_manager._from_other_process({"kind": "broadcast", "organization_id": str(tenant_a),
        "message": {"type": "chats_updated", "chat_id": "lead-ana"}, "sellers": [7]})
    assert len(own.messages) == 1
    assert foreign.messages == other_tenant.messages == []

"""Tests del disparo manual de flujos visuales desde el chat de un vendedor.

Cubre start_manual_flow_execution contra los puertos en memoria. Que el
índice único rechace de verdad una segunda ejecución en curso está en
``test_automation_store_postgres``.
"""

import pytest

from app.modules.automations.ports.types import AutomationBuilderMode, AutomationTrigger
from app.modules.automations.application.management import start_manual_flow_execution
from app.modules.automations.domain.events import AutomationsScheduled
from tests.automation_fakes import execution

RULE_ID = 42
LEAD_ID = "4316bc30-f78c-57a2-8f98-bff9087678d6"


def manual_rule(**overrides):
    defaults = {
        "id": RULE_ID,
        "name": "Bienvenida guiada",
        "builder_mode": AutomationBuilderMode.VISUAL,
        "trigger_type": AutomationTrigger.MANUAL,
        "is_active": True,
        "visible_to_sellers": True,
    }
    return {**defaults, **overrides}


@pytest.fixture
def world(in_memory_automations):
    """El agendado deja la ejecución en el store, como lo haría la base, para
    que el comando la pueda recuperar por su event_key."""
    scheduling = in_memory_automations.scheduling
    store = in_memory_automations.executions
    original = scheduling.schedule

    async def schedule(trigger_type, lead_id, event_key, payload=None, **kwargs):
        created = await original(trigger_type, lead_id, event_key, payload, **kwargs)
        if created:
            store.add(execution(id=555 + len(store.executions), rule_id=kwargs["rule_id"], event_key=event_key))
        return created

    scheduling.schedule = schedule
    in_memory_automations.rules.rules[RULE_ID] = manual_rule()
    return in_memory_automations


class TestStartManualFlowExecution:
    async def test_creates_execution_for_a_seller_when_flow_is_published_and_visible(self, world):
        result = await start_manual_flow_execution(RULE_ID, LEAD_ID, started_by_user_id=7, is_admin=False)

        assert result["id"] == 555
        [scheduled] = world.scheduling.scheduled
        assert (scheduled["start_source"], scheduled["started_by_user_id"], scheduled["rule_id"]) == ("manual", 7, RULE_ID)
        assert scheduled["payload"] == {"started_by_user_id": 7}
        assert world.of(AutomationsScheduled) == [AutomationsScheduled(count=1)]

    async def test_admin_can_start_even_when_not_marked_visible_to_sellers(self, world):
        world.rules.rules[RULE_ID] = manual_rule(visible_to_sellers=False)

        result = await start_manual_flow_execution(RULE_ID, LEAD_ID, started_by_user_id=1, is_admin=True)

        assert result["id"] == 555

    @pytest.mark.parametrize(("overrides", "is_admin", "message"), [
        ({"visible_to_sellers": False}, False, "no está disponible"),
        ({"builder_mode": AutomationBuilderMode.SIMPLE}, False, "flujo de inicio manual"),
        ({"trigger_type": AutomationTrigger.LEAD_CREATED}, False, "flujo de inicio manual"),
        ({"is_active": False}, True, "Publica y activa"),
    ])
    async def test_rejects_flows_that_cannot_be_started(self, world, overrides, is_admin, message):
        world.rules.rules[RULE_ID] = manual_rule(**overrides)

        with pytest.raises(ValueError, match=message):
            await start_manual_flow_execution(RULE_ID, LEAD_ID, started_by_user_id=7, is_admin=is_admin)
        assert world.scheduling.scheduled == []

    async def test_rejects_a_missing_flow(self, world):
        with pytest.raises(ValueError, match="Flujo no encontrado"):
            await start_manual_flow_execution(999, LEAD_ID, started_by_user_id=7, is_admin=True)

    async def test_raises_when_the_lead_does_not_exist_so_no_execution_was_created(self, world):
        """El agendado devuelve 0 sin insertar nada cuando el lead no existe;
        acá se traduce a un error claro en vez de intentar recuperar una
        ejecución que nunca se creó."""
        world.scheduling.created_per_call = 0

        with pytest.raises(ValueError, match="No se pudo iniciar"):
            await start_manual_flow_execution(RULE_ID, LEAD_ID, started_by_user_id=7, is_admin=False)

    async def test_two_consecutive_manual_starts_use_different_event_keys(self, world):
        """Un vendedor debe poder repetir el mismo flujo sobre el mismo lead:
        cada disparo manual necesita una event_key distinta para no chocar
        con el índice único (rule_id, event_key) de automation_executions."""
        await start_manual_flow_execution(RULE_ID, LEAD_ID, started_by_user_id=7, is_admin=False)
        await start_manual_flow_execution(RULE_ID, LEAD_ID, started_by_user_id=7, is_admin=False)

        first_key, second_key = (item["event_key"] for item in world.scheduling.scheduled)
        assert first_key != second_key
        assert first_key.startswith("manual:")
        assert second_key.startswith("manual:")

    async def test_second_start_while_one_is_active_raises_a_clear_error(self, world):
        """El índice único parcial (rule_id, lead_id) sobre ejecuciones
        manuales no terminales frena un doble click o dos vendedores
        arrancando el mismo flujo sobre el mismo lead: el conflicto se traduce
        a un mensaje claro en vez de propagarse como un 500."""
        world.scheduling.conflict = True

        with pytest.raises(ValueError, match="Ya hay una ejecución"):
            await start_manual_flow_execution(RULE_ID, LEAD_ID, started_by_user_id=7, is_admin=False)
        assert world.published == []

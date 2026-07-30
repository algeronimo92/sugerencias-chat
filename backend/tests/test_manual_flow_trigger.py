"""Tests del disparo manual de flujos visuales desde el chat de un vendedor.

Cubre start_manual_flow_execution sin PostgreSQL: get_automation_rule,
schedule_automation_event, get_sessionmaker y get_automation_execution se
sustituyen, siguiendo el mismo patrón que test_flow_versions.py.
"""

from unittest.mock import AsyncMock, patch

import pytest

from domain_types import AutomationBuilderMode, AutomationTrigger
from services.automation_service import start_manual_flow_execution

RULE_ID = 42
LEAD_ID = "51999@s.whatsapp.net"


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


def execution_row(**overrides):
    defaults = {
        "id": 555,
        "rule_id": RULE_ID,
        "rule_name": "Bienvenida guiada",
        "rule_deleted": False,
        "lead_id": LEAD_ID,
        "lead_name": "Ana",
        "trigger_type": AutomationTrigger.MANUAL,
        "status": "scheduled",
        "scheduled_for": None,
        "started_at": None,
        "finished_at": None,
        "action_results": [],
        "flow_state": {},
        "error": None,
        "created_at": None,
        "start_source": "manual",
        "started_by_user_id": 7,
    }
    return {**defaults, **overrides}


def session_scalar(value):
    """Sustituye get_sessionmaker() para la búsqueda del id de la ejecución
    recién creada (por rule_id + event_key) dentro de start_manual_flow_execution."""

    class FakeSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def scalar(self, stmt):
            return value

    return lambda: FakeSession


class TestStartManualFlowExecution:
    async def test_creates_execution_for_a_seller_when_flow_is_published_and_visible(self):
        with (
            patch("services.automation_service.get_automation_rule", AsyncMock(return_value=manual_rule())),
            patch("services.automation_service.schedule_automation_event", AsyncMock(return_value=1)) as schedule,
            patch("services.automation_service.get_sessionmaker", session_scalar(555)),
            patch("services.automation_service.get_automation_execution", AsyncMock(return_value=execution_row())),
        ):
            result = await start_manual_flow_execution(RULE_ID, LEAD_ID, started_by_user_id=7, is_admin=False)

        assert result["id"] == 555
        assert result["start_source"] == "manual"
        schedule.assert_awaited_once()
        _, kwargs = schedule.await_args
        assert kwargs["start_source"] == "manual"
        assert kwargs["started_by_user_id"] == 7
        assert kwargs["rule_id"] == RULE_ID

    async def test_admin_can_start_even_when_not_marked_visible_to_sellers(self):
        with (
            patch("services.automation_service.get_automation_rule", AsyncMock(
                return_value=manual_rule(visible_to_sellers=False),
            )),
            patch("services.automation_service.schedule_automation_event", AsyncMock(return_value=1)),
            patch("services.automation_service.get_sessionmaker", session_scalar(555)),
            patch("services.automation_service.get_automation_execution", AsyncMock(return_value=execution_row())),
        ):
            result = await start_manual_flow_execution(RULE_ID, LEAD_ID, started_by_user_id=1, is_admin=True)
        assert result["id"] == 555

    async def test_rejects_when_not_visible_to_sellers_and_caller_is_not_admin(self):
        with patch("services.automation_service.get_automation_rule", AsyncMock(
            return_value=manual_rule(visible_to_sellers=False),
        )):
            with pytest.raises(ValueError, match="no está disponible"):
                await start_manual_flow_execution(RULE_ID, LEAD_ID, started_by_user_id=7, is_admin=False)

    async def test_rejects_non_visual_rules(self):
        with patch("services.automation_service.get_automation_rule", AsyncMock(
            return_value=manual_rule(builder_mode=AutomationBuilderMode.SIMPLE),
        )):
            with pytest.raises(ValueError, match="flujo de inicio manual"):
                await start_manual_flow_execution(RULE_ID, LEAD_ID, started_by_user_id=7, is_admin=False)

    async def test_rejects_rules_whose_trigger_is_not_manual(self):
        with patch("services.automation_service.get_automation_rule", AsyncMock(
            return_value=manual_rule(trigger_type=AutomationTrigger.LEAD_CREATED),
        )):
            with pytest.raises(ValueError, match="flujo de inicio manual"):
                await start_manual_flow_execution(RULE_ID, LEAD_ID, started_by_user_id=7, is_admin=False)

    async def test_rejects_inactive_rule_even_for_admin(self):
        with patch("services.automation_service.get_automation_rule", AsyncMock(
            return_value=manual_rule(is_active=False),
        )):
            with pytest.raises(ValueError, match="Publica y activa"):
                await start_manual_flow_execution(RULE_ID, LEAD_ID, started_by_user_id=7, is_admin=True)

    async def test_raises_when_the_lead_does_not_exist_so_no_execution_was_created(self):
        """schedule_automation_event devuelve 0 sin insertar nada cuando el
        lead no existe (ver automation_service.py); acá se traduce a un error
        claro en vez de intentar recuperar una ejecución que nunca se creó."""
        with (
            patch("services.automation_service.get_automation_rule", AsyncMock(return_value=manual_rule())),
            patch("services.automation_service.schedule_automation_event", AsyncMock(return_value=0)),
        ):
            with pytest.raises(ValueError, match="No se pudo iniciar"):
                await start_manual_flow_execution(RULE_ID, LEAD_ID, started_by_user_id=7, is_admin=False)

    async def test_two_consecutive_manual_starts_use_different_event_keys(self):
        """Un vendedor debe poder repetir el mismo flujo sobre el mismo lead:
        cada disparo manual necesita una event_key distinta para no chocar
        con el índice único (rule_id, event_key) de automation_executions."""
        with (
            patch("services.automation_service.get_automation_rule", AsyncMock(return_value=manual_rule())),
            patch("services.automation_service.schedule_automation_event", AsyncMock(return_value=1)) as schedule,
            patch("services.automation_service.get_sessionmaker", session_scalar(555)),
            patch("services.automation_service.get_automation_execution", AsyncMock(return_value=execution_row())),
        ):
            await start_manual_flow_execution(RULE_ID, LEAD_ID, started_by_user_id=7, is_admin=False)
            await start_manual_flow_execution(RULE_ID, LEAD_ID, started_by_user_id=7, is_admin=False)

        assert schedule.await_count == 2
        first_key = schedule.await_args_list[0].kwargs["event_key"]
        second_key = schedule.await_args_list[1].kwargs["event_key"]
        assert first_key != second_key
        assert first_key.startswith("manual:")
        assert second_key.startswith("manual:")

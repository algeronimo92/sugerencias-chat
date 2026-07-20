"""Tests del historial de versiones de los flujos visuales."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from domain_types import AutomationBuilderMode
from services.automation_service import list_flow_versions, restore_flow_version

RULE_ID = 7


def visual_rule(**overrides):
    defaults = {
        "id": RULE_ID,
        "name": "Bienvenida",
        "builder_mode": AutomationBuilderMode.VISUAL,
        "flow_version": 3,
    }
    return {**defaults, **overrides}


def definition(nodes=2, edges=1):
    return {
        "conditions": {},
        "nodes": [
            {"id": f"n{i}", "type": "action" if i else "trigger", "position": {"x": i * 10, "y": 0}, "data": {}}
            for i in range(nodes)
        ],
        "edges": [
            {"id": f"e{i}", "source": f"n{i}", "target": f"n{i + 1}", "source_handle": "next"}
            for i in range(edges)
        ],
    }


def session_returning(rows=None, scalar=None):
    class FakeSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def execute(self, stmt):
            return SimpleNamespace(mappings=lambda: SimpleNamespace(all=lambda: rows or []))

        async def scalar(self, stmt):
            return scalar

    return lambda: FakeSession


class TestListFlowVersions:
    async def test_returns_empty_for_a_rule_that_is_not_visual(self):
        with patch("services.automation_service.get_automation_rule", AsyncMock(
            return_value=visual_rule(builder_mode=AutomationBuilderMode.SIMPLE),
        )):
            assert await list_flow_versions(RULE_ID) == []

    async def test_returns_empty_for_a_missing_rule(self):
        with patch("services.automation_service.get_automation_rule", AsyncMock(return_value=None)):
            assert await list_flow_versions(RULE_ID) == []

    async def test_marks_the_published_version_as_current(self):
        rows = [
            {"version": 3, "definition": definition(3, 2), "created_at": None},
            {"version": 2, "definition": definition(2, 1), "created_at": None},
        ]
        with (
            patch("services.automation_service.get_automation_rule", AsyncMock(return_value=visual_rule())),
            patch("services.automation_service.get_sessionmaker", session_returning(rows=rows)),
        ):
            versions = await list_flow_versions(RULE_ID)

        assert [item["version"] for item in versions] == [3, 2]
        assert versions[0]["is_current"] is True
        assert versions[1]["is_current"] is False
        assert versions[0]["node_count"] == 3
        assert versions[0]["edge_count"] == 2

    async def test_tolerates_a_version_with_an_empty_definition(self):
        rows = [{"version": 1, "definition": None, "created_at": None}]
        with (
            patch("services.automation_service.get_automation_rule", AsyncMock(return_value=visual_rule())),
            patch("services.automation_service.get_sessionmaker", session_returning(rows=rows)),
        ):
            versions = await list_flow_versions(RULE_ID)
        assert versions[0]["node_count"] == 0


class TestRestoreFlowVersion:
    async def test_returns_none_when_the_version_does_not_exist(self):
        with (
            patch("services.automation_service.get_automation_rule", AsyncMock(return_value=visual_rule())),
            patch("services.automation_service.get_sessionmaker", session_returning(scalar=None)),
        ):
            assert await restore_flow_version(RULE_ID, 99) is None

    async def test_returns_none_for_a_rule_that_is_not_visual(self):
        with patch("services.automation_service.get_automation_rule", AsyncMock(
            return_value=visual_rule(builder_mode=AutomationBuilderMode.SIMPLE),
        )):
            assert await restore_flow_version(RULE_ID, 1) is None

    async def test_loads_the_version_into_the_draft_without_publishing(self):
        """Restaurar no debe tocar published_flow_definition ni is_active: lo
        que ya está corriendo sigue igual hasta que el usuario publique."""
        update_mock = AsyncMock(return_value=visual_rule())
        with (
            patch("services.automation_service.get_automation_rule", AsyncMock(return_value=visual_rule())),
            patch("services.automation_service.get_sessionmaker", session_returning(scalar=definition(2, 1))),
            patch("services.automation_service.update_automation_rule", update_mock),
        ):
            await restore_flow_version(RULE_ID, 2)

        update_mock.assert_awaited_once()
        _, values = update_mock.await_args.args
        assert set(values) == {"flow_definition"}
        assert len(values["flow_definition"]["nodes"]) == 2

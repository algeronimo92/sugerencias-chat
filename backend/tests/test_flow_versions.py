"""Tests del historial de versiones de los flujos visuales."""

from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.modules.automations.ports.types import AutomationBuilderMode
from app.modules.automations import queries
from app.modules.automations.application import management
from app.modules.automations.application.management import publish_visual_flow, restore_flow_version
from app.modules.automations.domain.events import AutomationsChanged

RULE_ID = 7


def visual_rule(**overrides):
    defaults = {
        "id": RULE_ID,
        "name": "Bienvenida",
        "builder_mode": AutomationBuilderMode.VISUAL,
        "flow_version": 3,
        "flow_definition": {},
        "published_flow_definition": None,
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


def _read_side(monkeypatch, rule, rows=()):
    class FakeSession:
        async def execute(self, stmt):
            return SimpleNamespace(mappings=lambda: SimpleNamespace(all=lambda: list(rows)))

    @asynccontextmanager
    async def session_scope():
        yield FakeSession()

    monkeypatch.setattr(queries, "get_automation_rule", AsyncMock(return_value=rule))
    monkeypatch.setattr(queries, "session_scope", session_scope)


class TestListFlowVersions:
    async def test_returns_empty_for_a_rule_that_is_not_visual(self, monkeypatch):
        _read_side(monkeypatch, visual_rule(builder_mode=AutomationBuilderMode.SIMPLE))
        assert await queries.list_flow_versions(RULE_ID) == []

    async def test_returns_empty_for_a_missing_rule(self, monkeypatch):
        _read_side(monkeypatch, None)
        assert await queries.list_flow_versions(RULE_ID) == []

    async def test_marks_the_published_version_as_current(self, monkeypatch):
        _read_side(monkeypatch, visual_rule(), [
            {"version": 3, "definition": definition(3, 2), "created_at": None},
            {"version": 2, "definition": definition(2, 1), "created_at": None},
        ])

        versions = await queries.list_flow_versions(RULE_ID)

        assert [item["version"] for item in versions] == [3, 2]
        assert versions[0]["is_current"] is True
        assert versions[1]["is_current"] is False
        assert versions[0]["node_count"] == 3
        assert versions[0]["edge_count"] == 2

    async def test_tolerates_a_version_with_an_empty_definition(self, monkeypatch):
        _read_side(monkeypatch, visual_rule(), [{"version": 1, "definition": None, "created_at": None}])
        versions = await queries.list_flow_versions(RULE_ID)
        assert versions[0]["node_count"] == 0


class TestRestoreFlowVersion:
    async def test_returns_none_when_the_version_does_not_exist(self, in_memory_automations):
        in_memory_automations.rules.rules[RULE_ID] = visual_rule()
        assert await restore_flow_version(RULE_ID, 99) is None

    async def test_returns_none_for_a_rule_that_is_not_visual(self, in_memory_automations):
        in_memory_automations.rules.rules[RULE_ID] = visual_rule(builder_mode=AutomationBuilderMode.SIMPLE)
        in_memory_automations.executions.flow_versions[(RULE_ID, 1)] = definition()
        assert await restore_flow_version(RULE_ID, 1) is None

    async def test_loads_the_version_into_the_draft_without_publishing(self, in_memory_automations):
        """Restaurar no debe tocar published_flow_definition ni is_active: lo
        que ya está corriendo sigue igual hasta que el usuario publique."""
        published = definition(3, 2)
        in_memory_automations.rules.rules[RULE_ID] = visual_rule(published_flow_definition=published, is_active=True)
        in_memory_automations.executions.flow_versions[(RULE_ID, 2)] = definition(2, 1)

        restored = await restore_flow_version(RULE_ID, 2)

        assert len(restored["flow_definition"]["nodes"]) == 2
        assert restored["published_flow_definition"] == published
        assert restored["is_active"] is True
        assert in_memory_automations.of(AutomationsChanged) == [AutomationsChanged()]


class TestPublishFlowVersion:
    async def test_rejects_a_new_version_when_the_draft_matches_the_published_flow(
        self, in_memory_automations, monkeypatch,
    ):
        published = definition(2, 1)
        current = visual_rule(flow_definition=published, published_flow_definition=published)
        in_memory_automations.rules.rules[RULE_ID] = current
        monkeypatch.setattr(management, "validate_visual_flow", AsyncMock(return_value={
            "name": current["name"],
            "trigger_type": "lead_created",
            "trigger_config": {},
            "conditions": {},
            "flow_definition": published,
        }))

        with pytest.raises(ValueError, match="No hay cambios pendientes para publicar"):
            await publish_visual_flow(RULE_ID)

        assert in_memory_automations.rules.published == []
        assert in_memory_automations.published == []

    async def test_publishing_bumps_the_version_and_activates_the_flow(self, in_memory_automations, monkeypatch):
        in_memory_automations.rules.rules[RULE_ID] = visual_rule(flow_definition=definition(2, 1), trigger_type="manual")
        validated = {
            "name": "Bienvenida", "trigger_type": "manual", "trigger_config": {}, "conditions": {},
            "flow_definition": definition(2, 1),
        }
        monkeypatch.setattr(management, "validate_visual_flow", AsyncMock(return_value=validated))

        item = await publish_visual_flow(RULE_ID)

        assert in_memory_automations.rules.published == [(RULE_ID, validated, 4)]
        assert (item["flow_version"], item["is_active"]) == (4, True)
        assert in_memory_automations.of(AutomationsChanged) == [AutomationsChanged()]

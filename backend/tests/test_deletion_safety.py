"""Garantías para borrar plantillas y automatizaciones sin romper auditoría."""

from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from sqlalchemy.dialects import postgresql

from routers import automations, templates
from services import automation_service, productivity_service


@pytest.mark.parametrize(
    "definition",
    [
        [{"type": "send_template", "template_id": 7}],
        {"nodes": [{"data": {"action": {"type": "send_template", "template_id": 7}}}]},
        {"nested": {"template_id": "7"}},
    ],
)
def test_template_reference_is_found_in_simple_and_visual_definitions(definition):
    assert productivity_service._references_template(definition, 7)
    assert not productivity_service._references_template(definition, 8)


@pytest.mark.asyncio
async def test_rule_listing_excludes_soft_deleted_automations(monkeypatch):
    statements = []

    class FakeResult:
        def mappings(self):
            return self

        def all(self):
            return []

    class FakeSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def execute(self, statement):
            statements.append(statement)
            return FakeResult()

    monkeypatch.setattr(automation_service, "get_sessionmaker", lambda: FakeSession)
    assert await automation_service.list_automation_rules() == []
    sql = str(statements[0].compile(
        dialect=postgresql.dialect(),
        compile_kwargs={"literal_binds": True},
    ))
    assert "automation_rules.deleted_at IS NULL" in sql


@pytest.mark.asyncio
async def test_template_delete_returns_conflict_when_referenced(monkeypatch):
    monkeypatch.setattr(
        templates,
        "delete_template_record",
        AsyncMock(side_effect=ValueError("La plantilla está usada por: Seguimiento")),
    )

    with pytest.raises(HTTPException) as caught:
        await templates.delete_template(7, _admin=object())

    assert caught.value.status_code == 409
    assert "Seguimiento" in caught.value.detail


@pytest.mark.asyncio
async def test_automation_delete_returns_conflict_while_execution_runs(monkeypatch):
    monkeypatch.setattr(
        automations,
        "delete_automation_rule",
        AsyncMock(side_effect=ValueError("ejecución en curso")),
    )

    with pytest.raises(HTTPException) as caught:
        await automations.delete_rule(9, _admin=object())

    assert caught.value.status_code == 409
    assert "curso" in caught.value.detail

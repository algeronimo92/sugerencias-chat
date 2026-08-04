"""Pausa de automatización por lead (automatizacion_pausada).

Un trigger de sistema (message_received, stage_changed, *_overdue, ...) no
debe programar una ejecución nueva mientras el lead está pausado; un flujo
manual (el vendedor tocó "Iniciar flujo") sí debe seguir andando. Al pausar,
lo que ya quedó SCHEDULED de un trigger de sistema se cancela.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from domain_types import AutomationTrigger
from services import automation_service


class _SessionContext:
    def __init__(self, session):
        self._session = session

    async def __aenter__(self):
        return self._session

    async def __aexit__(self, *_args):
        return False


def _sessionmaker(session):
    return lambda: (lambda: _SessionContext(session))


class _EmptyRulesResult:
    def mappings(self):
        class _Mappings:
            def all(self_inner):
                return []
        return _Mappings()


@pytest.mark.asyncio
async def test_schedule_automation_event_skips_system_trigger_when_paused(monkeypatch):
    lead = SimpleNamespace(automatizacion_pausada=True)
    session = AsyncMock()
    session.get = AsyncMock(return_value=lead)
    monkeypatch.setattr(automation_service, "get_sessionmaker", _sessionmaker(session))

    created = await automation_service.schedule_automation_event(
        AutomationTrigger.MESSAGE_RECEIVED, "lead-1", "message:1",
    )

    assert created == 0
    session.execute.assert_not_awaited()


@pytest.mark.asyncio
async def test_schedule_automation_event_ignores_pause_for_manual_start(monkeypatch):
    """El vendedor tocó "Iniciar flujo" a propósito: la pausa no lo bloquea."""
    lead = SimpleNamespace(automatizacion_pausada=True)
    session = AsyncMock()
    session.get = AsyncMock(return_value=lead)
    session.execute = AsyncMock(return_value=_EmptyRulesResult())
    monkeypatch.setattr(automation_service, "get_sessionmaker", _sessionmaker(session))

    created = await automation_service.schedule_automation_event(
        AutomationTrigger.MANUAL, "lead-1", "manual:abc", rule_id=5, start_source="manual",
    )

    assert created == 0
    session.execute.assert_awaited()


@pytest.mark.asyncio
async def test_schedule_automation_event_runs_normally_when_not_paused(monkeypatch):
    lead = SimpleNamespace(automatizacion_pausada=False)
    session = AsyncMock()
    session.get = AsyncMock(return_value=lead)
    session.execute = AsyncMock(return_value=_EmptyRulesResult())
    monkeypatch.setattr(automation_service, "get_sessionmaker", _sessionmaker(session))

    created = await automation_service.schedule_automation_event(
        AutomationTrigger.MESSAGE_RECEIVED, "lead-1", "message:1",
    )

    assert created == 0
    session.execute.assert_awaited()


@pytest.mark.asyncio
async def test_cancel_scheduled_system_executions_broadcasts_when_rows_affected(monkeypatch):
    session = AsyncMock()
    session.execute = AsyncMock(return_value=SimpleNamespace(rowcount=2))
    monkeypatch.setattr(automation_service, "get_sessionmaker", _sessionmaker(session))
    broadcast = AsyncMock()
    monkeypatch.setattr(automation_service, "manager", SimpleNamespace(broadcast=broadcast))

    cancelled = await automation_service.cancel_scheduled_system_executions("lead-1")

    assert cancelled == 2
    broadcast.assert_awaited_once()


@pytest.mark.asyncio
async def test_cancel_scheduled_system_executions_skips_broadcast_when_nothing_cancelled(monkeypatch):
    session = AsyncMock()
    session.execute = AsyncMock(return_value=SimpleNamespace(rowcount=0))
    monkeypatch.setattr(automation_service, "get_sessionmaker", _sessionmaker(session))
    broadcast = AsyncMock()
    monkeypatch.setattr(automation_service, "manager", SimpleNamespace(broadcast=broadcast))

    cancelled = await automation_service.cancel_scheduled_system_executions("lead-1")

    assert cancelled == 0
    broadcast.assert_not_awaited()

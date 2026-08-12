"""Pausa de automatización por lead (automatizacion_pausada).

Un trigger de sistema (message_received, stage_changed, *_overdue, ...) no
debe programar una ejecución nueva mientras el lead está pausado; un flujo
manual (el vendedor tocó "Iniciar flujo") sí debe seguir andando. Al pausar,
lo que ya quedó SCHEDULED de un trigger de sistema se congela (PAUSED) y al
reanudar vuelve a la cola con el tiempo que le faltaba.
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
async def test_pause_lead_executions_broadcasts_when_rows_affected(monkeypatch):
    session = AsyncMock()
    session.execute = AsyncMock(return_value=SimpleNamespace(rowcount=2))
    monkeypatch.setattr(automation_service, "get_sessionmaker", _sessionmaker(session))
    broadcast = AsyncMock()
    monkeypatch.setattr(automation_service, "manager", SimpleNamespace(broadcast=broadcast))

    frozen = await automation_service.pause_lead_executions("lead-1")

    assert frozen == 2
    broadcast.assert_awaited_once()


@pytest.mark.asyncio
async def test_pause_lead_executions_skips_broadcast_when_nothing_frozen(monkeypatch):
    session = AsyncMock()
    session.execute = AsyncMock(return_value=SimpleNamespace(rowcount=0))
    monkeypatch.setattr(automation_service, "get_sessionmaker", _sessionmaker(session))
    broadcast = AsyncMock()
    monkeypatch.setattr(automation_service, "manager", SimpleNamespace(broadcast=broadcast))

    frozen = await automation_service.pause_lead_executions("lead-1")

    assert frozen == 0
    broadcast.assert_not_awaited()


@pytest.mark.asyncio
async def test_pause_lead_executions_freezes_instead_of_cancelling(monkeypatch):
    """La pausa no puede seguir marcando SKIPPED: ese estado es terminal y se
    llevaba puesto el flujo entero, incluido uno parado en un bloque Pausa."""
    session = AsyncMock()
    session.execute = AsyncMock(return_value=SimpleNamespace(rowcount=1))
    monkeypatch.setattr(automation_service, "get_sessionmaker", _sessionmaker(session))
    monkeypatch.setattr(automation_service, "manager", SimpleNamespace(broadcast=AsyncMock()))

    await automation_service.pause_lead_executions("lead-1")

    statement = str(session.execute.await_args.args[0]).lower()
    assert "paused_at" in statement
    assert "finished_at" not in statement


@pytest.mark.asyncio
async def test_resume_lead_executions_gives_back_the_remaining_time(monkeypatch):
    """Reanudar corre scheduled_for por lo que duró la pausa: a una espera de
    dos horas con veinte minutos restantes le quedan veinte, no dispara de
    golpe por haber vencido mientras estaba congelada."""
    session = AsyncMock()
    session.execute = AsyncMock(return_value=SimpleNamespace(rowcount=3))
    monkeypatch.setattr(automation_service, "get_sessionmaker", _sessionmaker(session))
    broadcast = AsyncMock()
    monkeypatch.setattr(automation_service, "manager", SimpleNamespace(broadcast=broadcast))

    resumed = await automation_service.resume_lead_executions("lead-1")

    assert resumed == 3
    broadcast.assert_awaited_once()
    statement = str(session.execute.await_args.args[0]).lower()
    assert "scheduled_for" in statement
    assert "paused_at" in statement
    # El scheduler tiene que enterarse: si no, lo reanudado espera al próximo
    # ciclo del bucle aunque ya venciera durante la pausa.
    assert automation_service._wake.is_set()


@pytest.mark.asyncio
async def test_resume_lead_executions_skips_broadcast_when_nothing_frozen(monkeypatch):
    session = AsyncMock()
    session.execute = AsyncMock(return_value=SimpleNamespace(rowcount=0))
    monkeypatch.setattr(automation_service, "get_sessionmaker", _sessionmaker(session))
    broadcast = AsyncMock()
    monkeypatch.setattr(automation_service, "manager", SimpleNamespace(broadcast=broadcast))
    automation_service._wake.clear()

    resumed = await automation_service.resume_lead_executions("lead-1")

    assert resumed == 0
    broadcast.assert_not_awaited()
    assert not automation_service._wake.is_set()

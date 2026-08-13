"""Pausa de automatización: la del lead entero (automatizacion_pausada) y la de
una sola ejecución (pause_scope).

Un trigger de sistema (message_received, stage_changed, *_overdue, ...) no
debe programar una ejecución nueva mientras el lead está pausado; un flujo
manual (el vendedor tocó "Iniciar flujo") sí debe seguir andando. Al pausar,
lo que ya quedó SCHEDULED de un trigger de sistema se congela (PAUSED) y al
reanudar vuelve a la cola con el tiempo que le faltaba.

El botón de pausa de una ejecución puntual usa el mismo congelado, pero marcado
con pause_scope='execution' para que reanudar el lead no lo pise.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from sqlalchemy.dialects import postgresql

from domain_types import AutomationExecutionStatus, AutomationTrigger
from services import automation_service


def _compile(statement) -> str:
    return str(statement.compile(
        dialect=postgresql.dialect(),
        compile_kwargs={"literal_binds": True},
    ))


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
async def test_resume_lead_executions_leaves_execution_scoped_pauses_frozen(monkeypatch):
    """Reanudar el chat no puede descongelar lo que el vendedor pausó a mano:
    esa ejecución solo vuelve con su propio botón. Las pausas anteriores a la
    columna (NULL) sí se reanudan, de ahí el IS DISTINCT FROM."""
    session = AsyncMock()
    session.execute = AsyncMock(return_value=SimpleNamespace(rowcount=1))
    monkeypatch.setattr(automation_service, "get_sessionmaker", _sessionmaker(session))
    monkeypatch.setattr(automation_service, "manager", SimpleNamespace(broadcast=AsyncMock()))

    await automation_service.resume_lead_executions("lead-1")

    statement = _compile(session.execute.await_args.args[0])
    assert "pause_scope IS DISTINCT FROM 'execution'" in statement


@pytest.mark.asyncio
async def test_pause_automation_execution_freezes_only_that_row(monkeypatch):
    """Congela una sola ejecución, marcada como pausa de ejecución para que
    reanudar el lead no la toque. Aplica también a los flujos manuales: es la
    única forma de frenar uno sin perder lo que ya avanzó."""
    session = AsyncMock()
    session.execute = AsyncMock(return_value=SimpleNamespace(rowcount=1))
    monkeypatch.setattr(automation_service, "get_sessionmaker", _sessionmaker(session))
    monkeypatch.setattr(automation_service, "manager", SimpleNamespace(broadcast=AsyncMock()))
    monkeypatch.setattr(
        automation_service, "get_automation_execution", AsyncMock(return_value={"id": 7})
    )

    item = await automation_service.pause_automation_execution(7)

    assert item == {"id": 7}
    statement = _compile(session.execute.await_args.args[0])
    assert "SET status='paused'" in statement.replace(" = ", "=")
    assert "pause_scope='execution'" in statement.replace(" = ", "=")
    # Solo lo que espera: una running está enviando un paso ahora mismo.
    assert "status = 'scheduled'" in statement
    assert "start_source" not in statement


@pytest.mark.asyncio
async def test_pause_automation_execution_returns_none_when_not_scheduled(monkeypatch):
    session = AsyncMock()
    session.execute = AsyncMock(return_value=SimpleNamespace(rowcount=0))
    monkeypatch.setattr(automation_service, "get_sessionmaker", _sessionmaker(session))
    broadcast = AsyncMock()
    monkeypatch.setattr(automation_service, "manager", SimpleNamespace(broadcast=broadcast))

    assert await automation_service.pause_automation_execution(7) is None
    broadcast.assert_not_awaited()


@pytest.mark.asyncio
async def test_resume_automation_execution_gives_back_the_remaining_time(monkeypatch):
    session = AsyncMock()
    session.get = AsyncMock(side_effect=[
        SimpleNamespace(
            status=AutomationExecutionStatus.PAUSED, start_source="system", lead_id="lead-1",
        ),
        SimpleNamespace(automatizacion_pausada=False),
    ])
    session.execute = AsyncMock(return_value=SimpleNamespace(rowcount=1))
    monkeypatch.setattr(automation_service, "get_sessionmaker", _sessionmaker(session))
    monkeypatch.setattr(automation_service, "manager", SimpleNamespace(broadcast=AsyncMock()))
    monkeypatch.setattr(
        automation_service, "get_automation_execution", AsyncMock(return_value={"id": 7})
    )
    automation_service._wake.clear()

    item = await automation_service.resume_automation_execution(7)

    assert item == {"id": 7}
    statement = _compile(session.execute.await_args.args[0])
    assert "scheduled_for" in statement
    assert "pause_scope=NULL" in statement.replace(" = ", "=")
    assert automation_service._wake.is_set()


@pytest.mark.asyncio
async def test_resume_automation_execution_refuses_while_the_lead_is_paused(monkeypatch):
    """Sin esto el botón aparentaría no hacer nada: process_due_automation_
    executions volvería a congelar la ejecución en cuanto venciera."""
    session = AsyncMock()
    session.get = AsyncMock(side_effect=[
        SimpleNamespace(
            status=AutomationExecutionStatus.PAUSED, start_source="system", lead_id="lead-1",
        ),
        SimpleNamespace(automatizacion_pausada=True),
    ])
    monkeypatch.setattr(automation_service, "get_sessionmaker", _sessionmaker(session))
    monkeypatch.setattr(automation_service, "manager", SimpleNamespace(broadcast=AsyncMock()))

    with pytest.raises(ValueError, match="botón del bot"):
        await automation_service.resume_automation_execution(7)
    session.execute.assert_not_awaited()


@pytest.mark.asyncio
async def test_resume_automation_execution_ignores_the_lead_pause_for_manual_flows(monkeypatch):
    """La pausa del lead nunca frena un flujo manual, así que tampoco puede
    bloquear su reanudación."""
    session = AsyncMock()
    session.get = AsyncMock(return_value=SimpleNamespace(
        status=AutomationExecutionStatus.PAUSED, start_source="manual", lead_id="lead-1",
    ))
    session.execute = AsyncMock(return_value=SimpleNamespace(rowcount=1))
    monkeypatch.setattr(automation_service, "get_sessionmaker", _sessionmaker(session))
    monkeypatch.setattr(automation_service, "manager", SimpleNamespace(broadcast=AsyncMock()))
    monkeypatch.setattr(
        automation_service, "get_automation_execution", AsyncMock(return_value={"id": 7})
    )

    assert await automation_service.resume_automation_execution(7) == {"id": 7}
    # Una sola consulta: ni miró el lead.
    assert session.get.await_count == 1


@pytest.mark.asyncio
async def test_resume_automation_execution_returns_none_when_not_paused(monkeypatch):
    session = AsyncMock()
    session.get = AsyncMock(return_value=SimpleNamespace(
        status=AutomationExecutionStatus.SCHEDULED, start_source="system", lead_id="lead-1",
    ))
    monkeypatch.setattr(automation_service, "get_sessionmaker", _sessionmaker(session))
    monkeypatch.setattr(automation_service, "manager", SimpleNamespace(broadcast=AsyncMock()))

    assert await automation_service.resume_automation_execution(7) is None
    session.execute.assert_not_awaited()


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

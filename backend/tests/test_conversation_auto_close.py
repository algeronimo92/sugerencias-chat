"""Cierre automático de conversaciones por inactividad.

El reloj lo reinicia cualquier mensaje del chat, no solo el del cliente: un
seguimiento del vendedor mantiene viva la conversación. El ajuste vive en
`conversation_auto_close_hours` y vacío o 0 lo desactiva por completo.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from sqlalchemy.dialects import postgresql

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


class _LeadIdsResult:
    def __init__(self, ids):
        self._ids = ids

    def scalars(self):
        return self

    def all(self):
        return self._ids


def _compile(statement) -> str:
    return str(statement.compile(
        dialect=postgresql.dialect(),
        compile_kwargs={"literal_binds": True},
    ))


@pytest.mark.parametrize("configured", ["", "0", "-4", "no es un número"])
def test_only_a_positive_number_of_hours_enables_the_sweep(configured) -> None:
    assert automation_service._auto_close_hours(configured) == 0


def test_a_decimal_setting_is_truncated_to_whole_hours() -> None:
    assert automation_service._auto_close_hours("24.0") == 24


@pytest.mark.asyncio
async def test_sweep_does_nothing_while_the_setting_is_empty(monkeypatch) -> None:
    session = AsyncMock()
    monkeypatch.setattr(automation_service, "get_sessionmaker", _sessionmaker(session))
    monkeypatch.setattr(automation_service, "get_effective", AsyncMock(return_value=""))
    update = AsyncMock()
    monkeypatch.setattr(automation_service, "update_lead", update)

    closed = await automation_service._auto_close_idle_conversations()

    assert closed == 0
    # Ni siquiera consulta: desactivado no puede costar una query por minuto.
    session.execute.assert_not_awaited()
    update.assert_not_awaited()


@pytest.mark.asyncio
async def test_closes_through_update_lead_so_queda_auditado(monkeypatch) -> None:
    session = AsyncMock()
    session.execute = AsyncMock(return_value=_LeadIdsResult(["lead-1", "lead-2"]))
    monkeypatch.setattr(automation_service, "get_sessionmaker", _sessionmaker(session))
    monkeypatch.setattr(automation_service, "get_effective", AsyncMock(return_value="12"))
    update = AsyncMock()
    monkeypatch.setattr(automation_service, "update_lead", update)
    broadcast = AsyncMock()
    monkeypatch.setattr(automation_service, "manager", SimpleNamespace(broadcast=broadcast))

    closed = await automation_service._auto_close_idle_conversations()

    assert closed == 2
    assert update.await_count == 2
    update.assert_awaited_with("lead-2", {"conversacion_abierta": False}, "system", None)
    assert broadcast.await_count == 2


@pytest.mark.asyncio
async def test_sweep_skips_paused_leads_and_measures_the_last_message(monkeypatch) -> None:
    session = AsyncMock()
    session.execute = AsyncMock(return_value=_LeadIdsResult([]))
    monkeypatch.setattr(automation_service, "get_sessionmaker", _sessionmaker(session))
    monkeypatch.setattr(automation_service, "get_effective", AsyncMock(return_value="12"))
    monkeypatch.setattr(automation_service, "update_lead", AsyncMock())

    await automation_service._auto_close_idle_conversations()

    sql = _compile(session.execute.await_args.args[0])
    assert "automatizacion_pausada IS false" in sql
    # El último mensaje de cualquiera de los dos lados, sin filtrar por emisor.
    assert "max(wsp_messages.sent_at)" in sql
    assert "sender" not in sql
    # Un chat sin mensajes se mide desde que la conversación se abrió.
    assert "coalesce" in sql
    assert "conversacion_abierta_at" in sql


@pytest.mark.asyncio
async def test_a_failed_close_does_not_abort_the_rest(monkeypatch) -> None:
    session = AsyncMock()
    session.execute = AsyncMock(return_value=_LeadIdsResult(["lead-1", "lead-2"]))
    monkeypatch.setattr(automation_service, "get_sessionmaker", _sessionmaker(session))
    monkeypatch.setattr(automation_service, "get_effective", AsyncMock(return_value="12"))
    monkeypatch.setattr(
        automation_service, "update_lead", AsyncMock(side_effect=[RuntimeError("boom"), None]),
    )
    monkeypatch.setattr(automation_service, "manager", SimpleNamespace(broadcast=AsyncMock()))

    closed = await automation_service._auto_close_idle_conversations()

    assert closed == 1

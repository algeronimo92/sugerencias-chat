"""Cierre automático de conversaciones por inactividad.

El reloj lo reinicia cualquier mensaje del chat, no solo el del cliente: un
seguimiento del vendedor mantiene viva la conversación. El ajuste vive en
`conversation_auto_close_hours` y vacío o 0 lo desactiva por completo.
"""

from contextlib import asynccontextmanager
from unittest.mock import AsyncMock

import pytest
from sqlalchemy.dialects import postgresql

from app.modules.automations.infrastructure import worker
from app.modules.leads.public import Actor


def _use_session(monkeypatch, session):
    @asynccontextmanager
    async def session_scope():
        yield session

    monkeypatch.setattr(worker, "session_scope", session_scope)


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
    assert worker._auto_close_hours(configured) == 0


def test_a_decimal_setting_is_truncated_to_whole_hours() -> None:
    assert worker._auto_close_hours("24.0") == 24


@pytest.mark.asyncio
async def test_sweep_does_nothing_while_the_setting_is_empty(monkeypatch) -> None:
    session = AsyncMock()
    _use_session(monkeypatch, session)
    monkeypatch.setattr(worker, "get_effective", AsyncMock(return_value=""))
    update = AsyncMock()
    monkeypatch.setattr(worker, "update_lead", update)

    closed = await worker._auto_close_idle_conversations()

    assert closed == 0
    # Ni siquiera consulta: desactivado no puede costar una query por minuto.
    session.execute.assert_not_awaited()
    update.assert_not_awaited()


@pytest.mark.asyncio
async def test_closes_through_update_lead_so_queda_auditado(monkeypatch) -> None:
    session = AsyncMock()
    session.execute = AsyncMock(return_value=_LeadIdsResult(["lead-1", "lead-2"]))
    _use_session(monkeypatch, session)
    monkeypatch.setattr(worker, "get_effective", AsyncMock(return_value="12"))
    update = AsyncMock()
    monkeypatch.setattr(worker, "update_lead", update)

    closed = await worker._auto_close_idle_conversations()

    assert closed == 2
    assert update.await_count == 2
    update.assert_awaited_with("lead-2", {"conversacion_abierta": False}, actor=Actor.system())
    # El aviso de conversación cerrada lo emite el suscriptor de leads.


@pytest.mark.asyncio
async def test_sweep_skips_paused_leads_and_measures_the_last_message(monkeypatch) -> None:
    session = AsyncMock()
    session.execute = AsyncMock(return_value=_LeadIdsResult([]))
    _use_session(monkeypatch, session)
    monkeypatch.setattr(worker, "get_effective", AsyncMock(return_value="12"))
    monkeypatch.setattr(worker, "update_lead", AsyncMock())

    await worker._auto_close_idle_conversations()

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
    _use_session(monkeypatch, session)
    monkeypatch.setattr(worker, "get_effective", AsyncMock(return_value="12"))
    monkeypatch.setattr(worker, "update_lead", AsyncMock(side_effect=[RuntimeError("boom"), None]))

    closed = await worker._auto_close_idle_conversations()

    assert closed == 1

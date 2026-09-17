"""Despacho de un mensaje programado.

`_dispatch` no tenía cobertura y era el segundo escritor de `message_outbox`:
armaba a mano el `WspMessage` y el `MessageOutbox`, copiando invariantes que
ya resuelve `enqueue_messages`. Estos tests fijan que pase por esa puerta.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from domain_types import ScheduledMessageStatus
from services import scheduled_message_service as sched

CHAT_ID = "51999999999@s.whatsapp.net"


class _SessionContext:
    def __init__(self, session):
        self._session = session

    async def __aenter__(self):
        return self._session

    async def __aexit__(self, *exc):
        return False


def _sessionmaker(session):
    return lambda: (lambda: _SessionContext(session))


def scheduled_row(**overrides):
    defaults = {
        "id": 5,
        "lead_id": CHAT_ID,
        "text": "Hola, ¿seguimos?",
        "status": ScheduledMessageStatus.PROCESSING,
        "error": None,
        "queued_message_id": None,
        "updated_at": None,
    }
    return SimpleNamespace(**{**defaults, **overrides})


@pytest.fixture
def entorno(monkeypatch):
    row = scheduled_row()
    session = AsyncMock()
    session.get = AsyncMock(return_value=row)
    session.execute = AsyncMock(return_value=SimpleNamespace(rowcount=1))
    monkeypatch.setattr(sched, "get_sessionmaker", _sessionmaker(session))
    monkeypatch.setattr(sched, "manager", SimpleNamespace(broadcast=AsyncMock()))
    enqueue = AsyncMock(return_value={"id": 77, "status": "PENDING"})
    monkeypatch.setattr(sched, "enqueue_text_message", enqueue)
    monkeypatch.setattr(sched, "service_window_is_open", AsyncMock(return_value=True))
    return SimpleNamespace(row=row, session=session, enqueue=enqueue)


async def test_it_queues_through_the_outbox_door_instead_of_writing_it_itself(entorno):
    await sched._dispatch(5)

    entorno.enqueue.assert_awaited_once()
    chat_id, text = entorno.enqueue.await_args.args
    assert (chat_id, text) == (CHAT_ID, "Hola, ¿seguimos?")


async def test_the_dedupe_key_is_derived_from_the_scheduled_row(entorno):
    """Estable entre reintentos: si el proceso se cae entre encolar y marcar
    QUEUED, el próximo intento devuelve el mismo mensaje en vez de otro."""
    await sched._dispatch(5)

    assert entorno.enqueue.await_args.kwargs["dedupe_key"] == "scheduled:5"


async def test_it_does_not_claim_a_human_saw_the_chat(entorno):
    """Sin actor_user_id: nadie está mirando la app cuando sale un programado,
    así que cuenta como atendido por bot."""
    await sched._dispatch(5)

    assert entorno.enqueue.await_args.kwargs.get("actor_user_id") is None


async def test_the_row_keeps_the_id_of_the_message_that_was_queued(entorno):
    await sched._dispatch(5)

    valores = entorno.session.execute.await_args.args[0].compile().params
    assert valores["status"] == ScheduledMessageStatus.QUEUED
    assert valores["queued_message_id"] == 77
    assert valores["error"] is None


async def test_a_closed_window_fails_without_queueing_anything(entorno, monkeypatch):
    monkeypatch.setattr(sched, "service_window_is_open", AsyncMock(return_value=False))

    await sched._dispatch(5)

    entorno.enqueue.assert_not_awaited()
    assert entorno.row.status == ScheduledMessageStatus.FAILED
    assert "24 horas" in entorno.row.error


@pytest.mark.parametrize("estado", [
    ScheduledMessageStatus.SCHEDULED,
    ScheduledMessageStatus.CANCELLED,
    ScheduledMessageStatus.QUEUED,
])
async def test_only_a_row_this_worker_claimed_is_dispatched(entorno, estado):
    """`_claim_due` deja la fila en processing; cualquier otro estado significa
    que la cancelaron o que ya salió."""
    entorno.row.status = estado

    await sched._dispatch(5)

    entorno.enqueue.assert_not_awaited()


async def test_a_row_that_disappeared_is_not_dispatched(entorno):
    entorno.session.get = AsyncMock(return_value=None)

    await sched._dispatch(5)

    entorno.enqueue.assert_not_awaited()

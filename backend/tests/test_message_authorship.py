"""Quién mandó cada mensaje saliente.

`sender` solo distingue cliente de vendedor, y con eso "cuántos mensajes mandé"
no se podía responder en un chat que atienden varias personas. La columna
`sent_by_user_id` la llenan los envíos que salen de la app; un envío de
automatización y un eco del celular del vendedor la dejan en NULL, y esa
diferencia es justamente lo que el dashboard cuenta.
"""

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from services import message_outbox, scheduled_message_service


class _SessionContext:
    def __init__(self, session):
        self._session = session

    async def __aenter__(self):
        return self._session

    async def __aexit__(self, *_args):
        return False


def _sessionmaker(session):
    return lambda: (lambda: _SessionContext(session))


def _added_messages(session):
    """Las filas de wsp_messages que el servicio agregó a la sesión."""
    return [
        call.args[0]
        for call in session.add.call_args_list
        if type(call.args[0]).__name__ == "WspMessage"
    ]


@pytest.fixture
def outbox_session(monkeypatch):
    session = AsyncMock()
    session.add = lambda obj: session.add.call_args_list.append(SimpleNamespace(args=(obj,)))
    session.add.call_args_list = []

    async def flush():
        for message in _added_messages(session):
            if message.id is None:
                message.id = 1

    session.flush = flush
    monkeypatch.setattr(message_outbox, "get_sessionmaker", _sessionmaker(session))
    monkeypatch.setattr(message_outbox.manager, "broadcast", AsyncMock(), raising=False)
    return session


@pytest.mark.asyncio
async def test_a_send_from_the_app_records_its_author(outbox_session):
    await message_outbox.enqueue_messages(
        "lead-1",
        [{"payload": {"type": "text", "text": "Hola"}, "content": "Hola"}],
        actor_user_id=7,
    )

    messages = _added_messages(outbox_session)
    assert [message.sent_by_user_id for message in messages] == [7]


@pytest.mark.asyncio
async def test_an_automation_send_has_no_author(outbox_session):
    """Sin actor no hay persona a quien acreditarlo: el mensaje es del bot y el
    dashboard no debe contarlo como trabajo de nadie."""
    await message_outbox.enqueue_messages(
        "lead-1",
        [{"payload": {"type": "text", "text": "Recordatorio"}, "content": "Recordatorio"}],
    )

    messages = _added_messages(outbox_session)
    assert [message.sent_by_user_id for message in messages] == [None]


@pytest.mark.asyncio
async def test_every_message_of_a_batch_carries_the_author(outbox_session):
    await message_outbox.enqueue_messages(
        "lead-1",
        [
            {"payload": {"type": "text", "text": "Uno"}, "content": "Uno"},
            {"payload": {"type": "text", "text": "Dos"}, "content": "Dos"},
        ],
        actor_user_id=11,
    )

    messages = _added_messages(outbox_session)
    assert [message.sent_by_user_id for message in messages] == [11, 11]


@pytest.mark.asyncio
async def test_a_scheduled_message_belongs_to_whoever_scheduled_it(monkeypatch):
    """Nadie estaba mirando la app cuando salió, pero el mensaje es obra de quien
    lo programó."""
    # La ventana de atención se considera abierta porque el último mensaje del
    # cliente (session.scalar) es de ahora.
    now = datetime.now(timezone.utc)
    scheduled = SimpleNamespace(
        lead_id="lead-1", text="Hola", status="processing",
        created_by_user_id=9, queued_message_id=None, error=None, updated_at=None,
    )
    session = AsyncMock()
    session.get = AsyncMock(return_value=scheduled)
    session.scalar = AsyncMock(return_value=now)  # ventana de atención abierta
    session.add = lambda obj: session.add.call_args_list.append(SimpleNamespace(args=(obj,)))
    session.add.call_args_list = []

    async def flush():
        for message in _added_messages(session):
            if message.id is None:
                message.id = 5

    session.flush = flush
    monkeypatch.setattr(scheduled_message_service, "get_sessionmaker", _sessionmaker(session))
    monkeypatch.setattr(scheduled_message_service.manager, "broadcast", AsyncMock(), raising=False)

    await scheduled_message_service._dispatch(1)

    messages = _added_messages(session)
    assert [message.sent_by_user_id for message in messages] == [9]

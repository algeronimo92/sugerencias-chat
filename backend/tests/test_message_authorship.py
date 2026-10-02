"""Quién mandó cada mensaje saliente.

`sender` solo distingue cliente de vendedor, y con eso "cuántos mensajes mandé"
no se podía responder en un chat que atienden varias personas. La columna
`sent_by_user_id` la llenan los envíos que salen de la app; un envío de
automatización y un eco del celular del vendedor la dejan en NULL, y esa
diferencia es justamente lo que el dashboard cuenta.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.modules.conversations import message_outbox, scheduled_message_service
from domain_types import ScheduledMessageStatus


class _SessionContext:
    def __init__(self, session):
        self._session = session

    async def __aenter__(self):
        return self._session

    async def __aexit__(self, *_args):
        return False


def _sessionmaker(session):
    return lambda: (lambda: _SessionContext(session))


def _text(body: str) -> dict:
    return {"message": {"type": "text", "text": {"body": body}}, "content": body}


@pytest.fixture
def outbox_session(monkeypatch):
    session = AsyncMock()
    added = []
    session.add = added.append
    session.added = added

    async def flush():
        for obj in added:
            if type(obj).__name__ == "WspMessage" and obj.id is None:
                obj.id = len(added)

    session.flush = flush
    monkeypatch.setattr(message_outbox, "get_sessionmaker", _sessionmaker(session))
    # La validación contra la allowlist de Meta tiene sus propios tests.
    monkeypatch.setattr(message_outbox, "prepare_items", AsyncMock(side_effect=lambda items: items))
    monkeypatch.setattr(message_outbox, "_message_dict", lambda message, reply_to=None: {"id": message.id})
    monkeypatch.setattr(message_outbox, "notify_new_work", lambda: None)
    return session


def _authors(session) -> list[int | None]:
    return [obj.sent_by_user_id for obj in session.added if type(obj).__name__ == "WspMessage"]


async def test_a_send_from_the_app_records_its_author(outbox_session):
    await message_outbox.enqueue_messages("lead-1", [_text("Hola")], actor_user_id=7)

    assert _authors(outbox_session) == [7]


async def test_an_automation_send_has_no_author(outbox_session):
    """Sin actor no hay persona a quien acreditarlo: el mensaje es del bot y el
    dashboard no debe contarlo como trabajo de nadie."""
    await message_outbox.enqueue_messages("lead-1", [_text("Recordatorio")])

    assert _authors(outbox_session) == [None]


async def test_every_message_of_a_batch_carries_the_author(outbox_session):
    await message_outbox.enqueue_messages("lead-1", [_text("Uno"), _text("Dos")], actor_user_id=11)

    assert _authors(outbox_session) == [11, 11]


async def test_an_explicit_author_does_not_count_as_a_human_seeing_the_chat(outbox_session, monkeypatch):
    """El autor acredita el mensaje; el actor decide el touch. Un programado
    tiene autor pero nadie lo está mirando, así que sigue siendo "atendido por
    bot"."""
    touches = []
    monkeypatch.setattr(message_outbox, "touch_last_read_stmt", lambda *a: touches.append("human"))
    monkeypatch.setattr(message_outbox, "touch_automated_reply_stmt", lambda *a: touches.append("bot"))

    await message_outbox.enqueue_messages("lead-1", [_text("Hola")], author_user_id=9)

    assert _authors(outbox_session) == [9]
    assert touches == ["bot"]


async def test_a_scheduled_message_belongs_to_whoever_scheduled_it(monkeypatch):
    """Nadie estaba mirando la app cuando salió, pero el mensaje es obra de quien
    lo programó."""
    scheduled = SimpleNamespace(
        id=1, lead_id="lead-1", text="Hola", status=ScheduledMessageStatus.PROCESSING,
        created_by_user_id=9, queued_message_id=None, error=None, updated_at=None,
    )
    session = AsyncMock()
    session.get = AsyncMock(return_value=scheduled)
    monkeypatch.setattr(
        scheduled_message_service.scheduled_message_repository, "get_sessionmaker", _sessionmaker(session)
    )
    monkeypatch.setattr(scheduled_message_service, "service_window_is_open", AsyncMock(return_value=True))
    monkeypatch.setattr(scheduled_message_service, "manager", SimpleNamespace(broadcast=AsyncMock()))
    enqueue = AsyncMock(return_value={"id": 5})
    monkeypatch.setattr(scheduled_message_service, "enqueue_text_message", enqueue)

    await scheduled_message_service._dispatch(1)

    assert enqueue.await_args.kwargs["author_user_id"] == 9
    assert enqueue.await_args.kwargs.get("actor_user_id") is None

from unittest.mock import AsyncMock

import pytest

from services import db_service


class _Result:
    def __init__(self, row=None):
        self.row = row

    def first(self):
        return self.row


class _SessionContext:
    def __init__(self, session):
        self.session = session

    async def __aenter__(self):
        return self.session

    async def __aexit__(self, *_args):
        return False


@pytest.mark.asyncio
async def test_order_events_only_deduplicate_by_exact_whatsapp_id(monkeypatch):
    session = AsyncMock()
    session.execute.return_value = _Result()
    monkeypatch.setattr(
        db_service,
        "get_sessionmaker",
        lambda: lambda: _SessionContext(session),
    )
    insert = AsyncMock(return_value={"id": 81})
    monkeypatch.setattr(db_service, "insert_message", insert)

    result = await db_service.reconcile_outgoing_message(
        "lead-1",
        "order",
        "Pago: Realizado",
        wa_message_id="ORDER-STATUS-2",
        payload={"order_id": "4VX5SPITUZD", "message": "Pago: Realizado"},
    )

    # Una consulta por ID exacto; no hace la segunda consulta difusa que antes
    # confundía varios estados orderMessage ocurridos en la misma ventana.
    assert session.execute.await_count == 1
    insert.assert_awaited_once()
    assert result == {"matched": False, "message_id": 81}


@pytest.mark.asyncio
async def test_repeated_exact_order_event_is_not_inserted(monkeypatch):
    session = AsyncMock()
    session.execute.return_value = _Result((81,))
    monkeypatch.setattr(
        db_service,
        "get_sessionmaker",
        lambda: lambda: _SessionContext(session),
    )
    insert = AsyncMock()
    monkeypatch.setattr(db_service, "insert_message", insert)

    result = await db_service.reconcile_outgoing_message(
        "lead-1", "order", "Pago: Realizado", wa_message_id="ORDER-STATUS-2"
    )

    assert result == {"matched": True}
    insert.assert_not_awaited()


@pytest.mark.asyncio
async def test_external_automation_is_recorded_as_automated(monkeypatch):
    session = AsyncMock()
    session.execute.return_value = _Result()
    monkeypatch.setattr(
        db_service,
        "get_sessionmaker",
        lambda: lambda: _SessionContext(session),
    )
    insert = AsyncMock(return_value={"id": 82})
    monkeypatch.setattr(db_service, "insert_message", insert)

    await db_service.reconcile_outgoing_message(
        "lead-1", "text", "Respuesta del bot", wa_message_id="BOT-1",
        payload={"source": "unknown"}, human_reply=False,
    )

    assert insert.await_args.kwargs["human_outbound"] is False


class _Row:
    def __init__(self, id):
        self.id = id


@pytest.mark.asyncio
async def test_matched_echo_backfills_message_secret(monkeypatch):
    # El insert original de la app no conoce el messageSecret todavía; el eco
    # de Evolution es lo único que lo trae, así que debe escribirse encima de
    # la fila ya existente en vez de perderse.
    session = AsyncMock()
    session.execute.return_value = _Result(_Row(81))
    monkeypatch.setattr(
        db_service,
        "get_sessionmaker",
        lambda: lambda: _SessionContext(session),
    )
    insert = AsyncMock()
    monkeypatch.setattr(db_service, "insert_message", insert)

    result = await db_service.reconcile_outgoing_message(
        "lead-1", "text", "Hola", wa_message_id="ECHO-1",
        message_secret=b"secret-bytes",
    )

    assert result == {"matched": True}
    insert.assert_not_awaited()
    assert session.execute.await_count == 2
    session.commit.assert_awaited()


@pytest.mark.asyncio
async def test_matched_echo_without_secret_skips_update(monkeypatch):
    session = AsyncMock()
    session.execute.return_value = _Result(_Row(81))
    monkeypatch.setattr(
        db_service,
        "get_sessionmaker",
        lambda: lambda: _SessionContext(session),
    )
    insert = AsyncMock()
    monkeypatch.setattr(db_service, "insert_message", insert)

    result = await db_service.reconcile_outgoing_message(
        "lead-1", "text", "Hola", wa_message_id="ECHO-1",
    )

    assert result == {"matched": True}
    assert session.execute.await_count == 1
    session.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_linked_device_message_is_recorded_as_human(monkeypatch):
    session = AsyncMock()
    session.execute.return_value = _Result()
    monkeypatch.setattr(
        db_service,
        "get_sessionmaker",
        lambda: lambda: _SessionContext(session),
    )
    insert = AsyncMock(return_value={"id": 83})
    monkeypatch.setattr(db_service, "insert_message", insert)

    await db_service.reconcile_outgoing_message(
        "lead-1", "text", "Respuesta humana", wa_message_id="PHONE-1",
        payload={"source": "web"}, human_reply=True,
    )

    assert insert.await_args.kwargs["human_outbound"] is True

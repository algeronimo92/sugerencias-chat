"""insert_message ante una colisión de wa_message_id.

Reproduce el bug real: una acción de automatización manda un WhatsApp y
guarda su propia fila con insert_message; casi al mismo tiempo, el eco del
webhook de ese mismo mensaje saliente lo inserta primero por otro camino
(reconcile_outgoing_message). Sin manejo, la segunda inserción revienta
con IntegrityError por el índice único de wa_message_id — hay que devolver
la fila que ya quedó guardada en vez de propagar el error.
"""

from datetime import datetime, timezone
from unittest.mock import AsyncMock

import pytest
from sqlalchemy.exc import IntegrityError

from services import db_service

EXISTING_ROW = {
    "id": 42,
    "sender": "vendedor",
    "content": "El *Hollywood Peel* es un tratamiento...",
    "sent_at": datetime.now(timezone.utc),
    "media_url": None,
    "wa_message_id": "3EB045F67C4BCA632B0931",
    "status": "SERVER_ACK",
    "message_type": "text",
    "analysis": None,
    "payload": None,
    "quoted_wa_message_id": None,
    "media_width": None,
    "media_height": None,
}


class _MappingsResult:
    def __init__(self, row):
        self._row = row

    def one(self):
        return self._row


class _ExecResult:
    def __init__(self, row):
        self._row = row

    def mappings(self):
        return _MappingsResult(self._row)


def _fake_session(existing_row):
    calls = {"n": 0}
    session = AsyncMock()

    async def execute(stmt):
        calls["n"] += 1
        if calls["n"] == 1:
            raise IntegrityError("insert", {}, Exception("duplicate key value violates unique constraint"))
        return _ExecResult(existing_row)

    session.execute.side_effect = execute
    return session


@pytest.mark.asyncio
async def test_insert_message_returns_existing_row_instead_of_raising(monkeypatch):
    session = _fake_session(EXISTING_ROW)

    class SessionContext:
        async def __aenter__(self):
            return session

        async def __aexit__(self, *_args):
            return False

    monkeypatch.setattr(db_service, "get_sessionmaker", lambda: SessionContext)

    result = await db_service.insert_message(
        "d17d73fb-70aa-4750-bfa2-c069e37d78db",
        "vendedor",
        "El *Hollywood Peel* es un tratamiento...",
        wa_message_id="3EB045F67C4BCA632B0931",
        status="SERVER_ACK",
        message_type="text",
    )

    assert result["id"] == 42
    assert result["wa_message_id"] == "3EB045F67C4BCA632B0931"
    session.rollback.assert_awaited_once()


@pytest.mark.asyncio
async def test_insert_message_without_wa_message_id_reraises(monkeypatch):
    """Sin wa_message_id no hay nada que buscar de vuelta: el error original
    (otra causa, p. ej. un chat_id inválido) debe propagarse tal cual."""
    session = _fake_session(EXISTING_ROW)

    class SessionContext:
        async def __aenter__(self):
            return session

        async def __aexit__(self, *_args):
            return False

    monkeypatch.setattr(db_service, "get_sessionmaker", lambda: SessionContext)

    with pytest.raises(IntegrityError):
        await db_service.insert_message(
            "chat-inexistente", "vendedor", "hola",
        )

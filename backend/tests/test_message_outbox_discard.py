"""Descartar un envío fallido que ya no vale la pena reintentar.

El caso que motivó esto: 58 mensajes viejos en `failed` que, tras revisarlos,
no se iban a reenviar. Mientras siguieran en ese estado contaban como fallos
vivos en `outbox_failed` y su burbuja seguía ofreciendo un reintento que nadie
iba a apretar. Descartar los cierra sin borrarlos: el mensaje no llegó y el
historial tiene que seguir diciéndolo.
"""

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from services import message_outbox


def _failed_message():
    return SimpleNamespace(
        id=42,
        sender="vendedor",
        content="Hola Ana, te escribo por tu consulta",
        sent_at=datetime(2026, 8, 7, 12, 0, tzinfo=timezone.utc),
        media_url=None,
        wa_message_id=None,
        status="FAILED",
        message_type="text",
        analysis=None,
        payload=None,
        quoted_wa_message_id=None,
    )


def _fake_session(job, message):
    session = AsyncMock()
    session.execute.return_value = SimpleNamespace(scalar_one_or_none=lambda: job)
    session.get.return_value = message
    return session


def _patch_session(monkeypatch, session):
    class SessionContext:
        async def __aenter__(self):
            return session

        async def __aexit__(self, *_args):
            return False

    monkeypatch.setattr(message_outbox, "get_sessionmaker", lambda: SessionContext)


@pytest.mark.asyncio
async def test_discard_closes_the_job_and_marks_the_message(monkeypatch):
    job = SimpleNamespace(status="failed", updated_at=None)
    message = _failed_message()
    _patch_session(monkeypatch, _fake_session(job, message))
    broadcast = AsyncMock()
    monkeypatch.setattr(message_outbox, "manager", SimpleNamespace(broadcast=broadcast))

    result = await message_outbox.discard_failed_message("51999@s.whatsapp.net", 42)

    # El job sale de "failed": es lo que lo saca de la métrica outbox_failed.
    assert job.status == "discarded"
    assert message.status == "DISCARDED"
    assert result["status"] == "DISCARDED"
    broadcast.assert_awaited_once()
    assert broadcast.await_args[0][0]["message_statuses"] == [{"id": 42, "status": "DISCARDED"}]


@pytest.mark.asyncio
async def test_discard_ignores_a_message_that_is_not_failed(monkeypatch):
    """El WHERE exige failed/FAILED, así que un mensaje ya enviado —o ya
    descartado— no encuentra job y el router responde 409 en vez de tocar
    nada."""
    session = _fake_session(None, None)
    _patch_session(monkeypatch, session)
    broadcast = AsyncMock()
    monkeypatch.setattr(message_outbox, "manager", SimpleNamespace(broadcast=broadcast))

    result = await message_outbox.discard_failed_message("51999@s.whatsapp.net", 42)

    assert result is None
    session.commit.assert_not_awaited()
    broadcast.assert_not_awaited()

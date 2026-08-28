"""pin_message/unpin_message/fetch_pinned_messages: fijado nativo del CRM
(no existe forma de mandarlo hacia WhatsApp). Mismo doble de sesión que
test_message_edit_secret_db.py (no hay Postgres en este entorno de tests)."""

from datetime import datetime, timezone
from unittest.mock import AsyncMock

import pytest

from services import db_service
from services.db_service import PinLimitReachedError

CHAT_ID = "d17d73fb-70aa-4750-bfa2-c069e37d78db"


class _Row:
    """Doble mínimo de WspMessage: solo los atributos que _message_payload y
    las funciones bajo prueba tocan."""

    def __init__(self, **overrides):
        defaults = dict(
            id=42,
            chat_id=CHAT_ID,
            sender="cliente",
            content="texto original",
            sent_at=datetime.now(timezone.utc),
            media_url=None,
            wa_message_id="3EB0ABCDEF1234567890",
            status="SERVER_ACK",
            message_type="text",
            analysis=None,
            payload=None,
            reactions=None,
            edited_at=None,
            deleted_at=None,
            pinned_at=None,
            pinned_by_user_id=None,
            media_width=None,
            media_height=None,
        )
        defaults.update(overrides)
        for key, value in defaults.items():
            setattr(self, key, value)


class _ScalarResult:
    def __init__(self, row):
        self._row = row

    def scalar_one_or_none(self):
        return self._row


def _session_context(row, *, pinned_count=0):
    session = AsyncMock()
    session.execute.return_value = _ScalarResult(row)
    session.scalar.return_value = pinned_count

    class SessionContext:
        async def __aenter__(self):
            return session

        async def __aexit__(self, *_args):
            return False

    return SessionContext, session


@pytest.mark.asyncio
async def test_pin_sets_pinned_at_and_user_when_under_the_limit(monkeypatch):
    row = _Row()
    SessionContext, session = _session_context(row, pinned_count=1)
    monkeypatch.setattr(db_service, "get_sessionmaker", lambda: SessionContext)

    result = await db_service.pin_message(CHAT_ID, 42, user_id=7)

    assert result["pinned_at"] is not None
    assert row.pinned_by_user_id == 7
    session.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_pin_raises_when_chat_already_has_the_limit(monkeypatch):
    row = _Row()
    SessionContext, session = _session_context(row, pinned_count=3)
    monkeypatch.setattr(db_service, "get_sessionmaker", lambda: SessionContext)

    with pytest.raises(PinLimitReachedError):
        await db_service.pin_message(CHAT_ID, 42, user_id=7)

    assert row.pinned_at is None
    session.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_pin_is_idempotent_and_does_not_recheck_the_limit(monkeypatch):
    already_pinned_at = datetime.now(timezone.utc)
    row = _Row(pinned_at=already_pinned_at, pinned_by_user_id=3)
    # pinned_count=3 probaría que igual pasa: un mensaje ya fijado no vuelve a
    # contar contra el límite al "re-fijarse".
    SessionContext, session = _session_context(row, pinned_count=3)
    monkeypatch.setattr(db_service, "get_sessionmaker", lambda: SessionContext)

    result = await db_service.pin_message(CHAT_ID, 42, user_id=7)

    assert result["pinned_at"] is not None
    assert row.pinned_by_user_id == 3  # no lo pisa el segundo usuario
    session.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_pin_returns_none_for_a_deleted_message(monkeypatch):
    row = _Row(deleted_at=datetime.now(timezone.utc))
    SessionContext, session = _session_context(row)
    monkeypatch.setattr(db_service, "get_sessionmaker", lambda: SessionContext)

    assert await db_service.pin_message(CHAT_ID, 42, user_id=7) is None
    session.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_pin_returns_none_when_message_not_found(monkeypatch):
    SessionContext, session = _session_context(None)
    monkeypatch.setattr(db_service, "get_sessionmaker", lambda: SessionContext)

    assert await db_service.pin_message(CHAT_ID, 999, user_id=7) is None


@pytest.mark.asyncio
async def test_unpin_clears_pinned_fields(monkeypatch):
    row = _Row(pinned_at=datetime.now(timezone.utc), pinned_by_user_id=7)
    SessionContext, session = _session_context(row)
    monkeypatch.setattr(db_service, "get_sessionmaker", lambda: SessionContext)

    result = await db_service.unpin_message(CHAT_ID, 42)

    assert result["pinned_at"] is None
    assert row.pinned_by_user_id is None
    session.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_unpin_is_idempotent(monkeypatch):
    row = _Row(pinned_at=None)
    SessionContext, session = _session_context(row)
    monkeypatch.setattr(db_service, "get_sessionmaker", lambda: SessionContext)

    result = await db_service.unpin_message(CHAT_ID, 42)

    assert result["pinned_at"] is None
    session.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_unpin_returns_none_when_message_not_found(monkeypatch):
    SessionContext, session = _session_context(None)
    monkeypatch.setattr(db_service, "get_sessionmaker", lambda: SessionContext)

    assert await db_service.unpin_message(CHAT_ID, 999) is None

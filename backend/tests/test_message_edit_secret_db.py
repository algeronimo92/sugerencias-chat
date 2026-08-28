"""update_message_content_from_secret: hermana de update_message_content para
la edición nativa cifrada. Mismo doble de sesión que test_insert_message_dedup.py
(no hay Postgres en este entorno de tests)."""

import os
from datetime import datetime, timezone
from unittest.mock import AsyncMock

import pytest
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from services import db_service
from services.message_edit_crypto import derive_edit_key

CHAT_ID = "d17d73fb-70aa-4750-bfa2-c069e37d78db"
WA_MESSAGE_ID = "3EB0ABCDEF1234567890"
SENDER = "51999888777@s.whatsapp.net"


class _Row:
    """Doble mínimo de WspMessage: solo los atributos que
    _load_message_by_wa_id/_message_payload y la función bajo prueba tocan."""

    def __init__(self, **overrides):
        defaults = dict(
            id=42,
            chat_id=CHAT_ID,
            sender="cliente",
            content="texto original",
            sent_at=datetime.now(timezone.utc),
            media_url=None,
            wa_message_id=WA_MESSAGE_ID,
            status="SERVER_ACK",
            message_type="text",
            analysis=None,
            payload=None,
            reactions=None,
            edited_at=None,
            deleted_at=None,
            pinned_at=None,
            media_width=None,
            media_height=None,
            message_secret=None,
        )
        defaults.update(overrides)
        for key, value in defaults.items():
            setattr(self, key, value)


class _ScalarResult:
    def __init__(self, row):
        self._row = row

    def scalar_one_or_none(self):
        return self._row


def _session_context(row):
    session = AsyncMock()
    session.execute.return_value = _ScalarResult(row)

    class SessionContext:
        async def __aenter__(self):
            return session

        async def __aexit__(self, *_args):
            return False

    return SessionContext, session


def _encrypt(plaintext: bytes, secret: bytes, message_id: str, sender: str) -> tuple[bytes, bytes]:
    key = derive_edit_key(secret, message_id, sender)
    nonce = os.urandom(12)
    return AESGCM(key).encrypt(nonce, plaintext, None), nonce


def _conversation_field(text: str) -> bytes:
    # field 1, wire type 2 (length-delimited): equivalente a Message.conversation.
    payload = text.encode()
    tag = (1 << 3) | 2
    return bytes([tag]) + bytes([len(payload)]) + payload


@pytest.mark.asyncio
async def test_null_secret_returns_none_and_does_not_touch_row(monkeypatch):
    row = _Row(message_secret=None, content="texto original")
    SessionContext, session = _session_context(row)
    monkeypatch.setattr(db_service, "get_sessionmaker", lambda: SessionContext)

    result = await db_service.update_message_content_from_secret(
        CHAT_ID, WA_MESSAGE_ID, [SENDER], b"payload-cifrado", os.urandom(12)
    )

    assert result is None
    assert row.content == "texto original"
    session.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_unknown_message_returns_none(monkeypatch):
    SessionContext, session = _session_context(None)
    monkeypatch.setattr(db_service, "get_sessionmaker", lambda: SessionContext)

    result = await db_service.update_message_content_from_secret(
        CHAT_ID, "id-desconocido", [SENDER], b"payload-cifrado", os.urandom(12)
    )

    assert result is None
    session.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_deleted_message_returns_none_even_with_secret(monkeypatch):
    row = _Row(message_secret=os.urandom(32), deleted_at=datetime.now(timezone.utc))
    SessionContext, session = _session_context(row)
    monkeypatch.setattr(db_service, "get_sessionmaker", lambda: SessionContext)

    result = await db_service.update_message_content_from_secret(
        CHAT_ID, WA_MESSAGE_ID, [SENDER], b"payload-cifrado", os.urandom(12)
    )

    assert result is None
    session.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_no_sender_candidate_matches_leaves_content_untouched(monkeypatch):
    secret = os.urandom(32)
    ciphertext, nonce = _encrypt(_conversation_field("nuevo texto"), secret, WA_MESSAGE_ID, SENDER)
    row = _Row(message_secret=secret, content="texto original")
    SessionContext, session = _session_context(row)
    monkeypatch.setattr(db_service, "get_sessionmaker", lambda: SessionContext)

    result = await db_service.update_message_content_from_secret(
        CHAT_ID, WA_MESSAGE_ID, ["999@lid"], ciphertext, nonce
    )

    assert result is None
    assert row.content == "texto original"
    session.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_matching_candidate_updates_content_and_edited_at(monkeypatch):
    secret = os.urandom(32)
    ciphertext, nonce = _encrypt(_conversation_field("precio correcto: 450"), secret, WA_MESSAGE_ID, SENDER)
    row = _Row(message_secret=secret, content="texto original", edited_at=None)
    SessionContext, session = _session_context(row)
    monkeypatch.setattr(db_service, "get_sessionmaker", lambda: SessionContext)

    result = await db_service.update_message_content_from_secret(
        CHAT_ID, WA_MESSAGE_ID, ["999@lid", SENDER], ciphertext, nonce
    )

    assert result is not None
    assert result["content"] == "precio correcto: 450"
    assert row.edited_at is not None
    session.commit.assert_awaited_once()

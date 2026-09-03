"""fetch_lead_raw / fetch_messages_raw / ensure_lead_stub: las funciones que
reemplazan a los nodos Postgres directos de rag.json (get lead1, get
messages, create lead). Mismo doble de sesión que test_insert_message_dedup.py
-no hay base de datos real en estos tests."""

from datetime import datetime, timezone
from unittest.mock import AsyncMock

import pytest

from services import db_service

LEAD_ID = "7b08f4d9-855f-4718-b95f-9c021da52f77"


class _ExecResult:
    def __init__(self, *, scalar=None, row=None, rows=None):
        self._scalar = scalar
        self._row = row
        self._rows = rows

    def scalar_one_or_none(self):
        return self._scalar

    def mappings(self):
        return self

    def first(self):
        return self._row

    def all(self):
        return self._rows if self._rows is not None else []


def _session_context(session):
    class SessionContext:
        async def __aenter__(self):
            return session

        async def __aexit__(self, *_args):
            return False

    return SessionContext


def _patch_sessionmaker(monkeypatch, session):
    monkeypatch.setattr(db_service, "get_sessionmaker", lambda: _session_context(session))


@pytest.mark.asyncio
async def test_fetch_lead_raw_returns_none_when_no_row(monkeypatch):
    session = AsyncMock()
    session.execute = AsyncMock(return_value=_ExecResult(row=None))
    _patch_sessionmaker(monkeypatch, session)

    result = await db_service.fetch_lead_raw(LEAD_ID)

    assert result is None


@pytest.mark.asyncio
async def test_fetch_lead_raw_json_safes_datetime_and_drops_bytes(monkeypatch):
    row = {
        "id": LEAD_ID,
        "estado": "nuevo",
        "created_at": datetime(2026, 9, 3, 10, 0, 0, tzinfo=timezone.utc),
        "ultimo_mensaje_at": None,
        "some_legacy_bytes": b"\x00\x01",
    }
    session = AsyncMock()
    session.execute = AsyncMock(return_value=_ExecResult(row=row))
    _patch_sessionmaker(monkeypatch, session)

    result = await db_service.fetch_lead_raw(LEAD_ID)

    assert result["id"] == LEAD_ID
    assert result["created_at"] == "2026-09-03T10:00:00.000000Z"
    assert result["some_legacy_bytes"] is None


@pytest.mark.asyncio
async def test_fetch_messages_raw_orders_and_strips_secret(monkeypatch):
    rows = [
        {"id": 2, "chat_id": LEAD_ID, "content": "b", "message_secret": b"shh"},
        {"id": 1, "chat_id": LEAD_ID, "content": "a", "message_secret": None},
    ]
    session = AsyncMock()
    session.execute = AsyncMock(return_value=_ExecResult(rows=rows))
    _patch_sessionmaker(monkeypatch, session)

    result = await db_service.fetch_messages_raw(LEAD_ID, limit=500)

    assert [r["id"] for r in result] == [2, 1]
    assert all("message_secret" not in r for r in result)


@pytest.mark.asyncio
async def test_ensure_lead_stub_skips_conflicting_lead(monkeypatch):
    # ON CONFLICT DO NOTHING -> scalar_one_or_none() vuelve None: no había
    # que crear nada, y por lo tanto tampoco se toca ultimo_mensaje_at.
    session = AsyncMock()
    existing_row = {"id": LEAD_ID, "estado": "en_seguimiento"}
    session.execute = AsyncMock(
        side_effect=[_ExecResult(scalar=None), _ExecResult(row=existing_row)]
    )
    _patch_sessionmaker(monkeypatch, session)

    result = await db_service.ensure_lead_stub(LEAD_ID, "2026-09-03T10:00:00Z", "Facebook Ads")

    assert session.execute.await_count == 2  # insert intentado + el select de fetch_lead_raw
    assert result == existing_row


@pytest.mark.asyncio
async def test_ensure_lead_stub_writes_ultimo_mensaje_at_on_new_lead(monkeypatch):
    new_row = {"id": LEAD_ID, "estado": "nuevo", "ultimo_mensaje_at": "2026-09-03T10:00:00.000000Z"}
    session = AsyncMock()
    session.execute = AsyncMock(
        side_effect=[
            _ExecResult(scalar=LEAD_ID),  # el INSERT sí creó la fila
            _ExecResult(),  # UPDATE ultimo_mensaje_at
            _ExecResult(row=new_row),  # fetch_lead_raw
        ]
    )
    _patch_sessionmaker(monkeypatch, session)

    result = await db_service.ensure_lead_stub(LEAD_ID, "2026-09-03T10:00:00Z", "Facebook Ads")

    assert session.execute.await_count == 3
    assert result == new_row

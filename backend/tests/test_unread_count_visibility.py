"""El contador global de no leídos cuenta lo mismo que el filtro de la lista.

Antes contaba los chats de cualquier número, también los de instancias
viejas que la lista nunca muestra: quedaba en "+99" con el filtro vacío y no
había forma de bajarlo.
"""

from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy.dialects import postgresql

from app.modules.conversations import chat_queries, inbox_queries


def _sql(statement) -> str:
    return str(statement.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))


@pytest.fixture
def captured(monkeypatch):
    statements = []
    session = MagicMock()

    async def execute(statement):
        statements.append(statement)
        result = MagicMock()
        result.scalar_one.return_value = 7
        return result

    session.execute = execute

    @asynccontextmanager
    async def session_scope():
        yield session

    monkeypatch.setattr(inbox_queries, "session_scope", session_scope)
    return statements


@pytest.mark.asyncio
async def test_only_chats_of_the_active_number_are_counted(monkeypatch, captured):
    monkeypatch.setattr(chat_queries, "connection_scope", AsyncMock(return_value=("1264142756787940", "*")))

    assert await inbox_queries.fetch_total_unread_chat_count() == 7

    sql = _sql(captured[0])
    assert "whatsapp_identities.phone_number_id IN ('1264142756787940', '*')" in sql
    assert "wsp_messages.sender = 'cliente'" in sql
    assert "leads.last_read_at IS NULL" in sql


@pytest.mark.asyncio
async def test_without_a_connected_number_nothing_is_hidden(monkeypatch, captured):
    monkeypatch.setattr(chat_queries, "connection_scope", AsyncMock(return_value=None))

    await inbox_queries.fetch_total_unread_chat_count()

    assert "whatsapp_identities" not in _sql(captured[0])

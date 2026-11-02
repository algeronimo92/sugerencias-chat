"""El ON CONFLICT de los eventos de mensaje tiene que encontrar su índice.

Los índices únicos de ``whatsapp_message_events`` son parciales. PostgreSQL
solo usa uno para el ON CONFLICT si el WHERE de la sentencia implica el del
índice, y un parámetro (``kind = $8``) no implica nada: el INSERT falla con
"no unique or exclusion constraint matching". Pasó en producción con cada
estado de entrega. Por eso se mira el SQL tal como lo recibe asyncpg, sin
``literal_binds``, que escondería justamente el parámetro.
"""

from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy.dialects import postgresql

from app.modules.conversations.infrastructure import sql_messages


def _session(monkeypatch) -> AsyncMock:
    session = AsyncMock()
    result = MagicMock()
    result.first.return_value = None
    result.scalar_one_or_none.return_value = None
    session.execute = AsyncMock(return_value=result)
    monkeypatch.setattr(sql_messages, "current_session", lambda: session)
    return session


def _on_conflict(statement) -> str:
    sql = str(statement.compile(dialect=postgresql.dialect()))
    return sql[sql.index("ON CONFLICT"):]


@pytest.mark.asyncio
async def test_status_conflict_names_the_partial_index_predicate_literally(monkeypatch) -> None:
    session = _session(monkeypatch)

    await sql_messages.SqlMessageStore().record_status_event(
        {"id": "wamid.1", "status": "delivered"}, occurred_at=None, webhook_event_id=None,
    )

    insert = session.execute.await_args_list[1].args[0]
    clause = _on_conflict(insert)
    assert "(wa_message_id, value, occurred_at) WHERE kind = 'status'" in clause
    assert "%(" not in clause.split("DO NOTHING")[0]


@pytest.mark.asyncio
async def test_reaction_conflict_has_no_parameter_in_the_predicate(monkeypatch) -> None:
    session = _session(monkeypatch)

    await sql_messages.SqlMessageStore().record_reaction_event(
        event_wa_id="wamid.r", target_wa_message_id="wamid.1", chat_id=None, emoji="x",
        actor="customer", provider_payload={}, occurred_at=None, webhook_event_id=None,
    )

    clause = _on_conflict(session.execute.await_args.args[0])
    assert "(event_wa_id) WHERE event_wa_id IS NOT NULL" in clause
    assert "%(" not in clause.split("DO NOTHING")[0]

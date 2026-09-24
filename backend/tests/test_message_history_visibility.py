import pytest
from sqlalchemy.dialects import postgresql

from services.store import message_history


@pytest.mark.asyncio
async def test_unsupported_message_without_original_type_stays_visible(monkeypatch):
    """Solo se oculta un sobre de album identificado de forma explicita.

    En PostgreSQL, ``NOT (TRUE AND NULL)`` devuelve ``NULL`` y una clausula
    ``WHERE`` descarta esa fila. Las respuestas de boton de Meta se guardan
    como ``unsupported`` pero su payload no contiene ``original_type``; el
    filtro debe tratar ese caso como visible.
    """
    statements = []

    class FakeResult:
        def mappings(self):
            return self

        def all(self):
            return []

    class FakeSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def execute(self, statement):
            statements.append(statement)
            return FakeResult()

    monkeypatch.setattr(message_history, "get_sessionmaker", lambda: FakeSession)

    result = await message_history.fetch_messages("00000000-0000-0000-0000-000000000001")

    assert result == {"items": [], "has_more": False}
    sql = str(statements[0].compile(
        dialect=postgresql.dialect(),
        compile_kwargs={"literal_binds": True},
    ))
    assert "wsp_messages.message_type = 'unsupported'" in sql
    assert "IS NOT true" in sql

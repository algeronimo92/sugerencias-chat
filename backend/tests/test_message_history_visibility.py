import pytest
from sqlalchemy.dialects import postgresql

from app.modules.conversations import message_history


@pytest.mark.asyncio
async def test_thread_serves_every_meta_type_and_hides_only_reactions(monkeypatch):
    """Un tipo que el contrato no conoce se sirve igual (con su nombre
    literal); las reacciones no, porque se muestran como badge del mensaje
    al que apuntan."""
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
    assert "wsp_messages.message_type IS DISTINCT FROM 'reaction'" in sql
    assert "unsupported" not in sql
    for column in ("provider_payload", "message_subtype", "outbox_status", "meta_status", "status_payload"):
        assert f"wsp_messages.{column}" in sql

"""Cada mensaje del negocio dice de dónde salió.

Incidente que lo motivó: una plantilla enviada a mano era idéntica al primer
envío de un flujo y, mirando el chat, nadie podía saber si el flujo había
arrancado. El origen no es una columna: se deriva de la clave de dedupe del
outbox, de ``sent_by_user_id`` y de si el mensaje pasó por el outbox.
"""

import pytest
from sqlalchemy.dialects import postgresql

from app.modules.conversations import message_history, message_origin
from app.modules.conversations.domain.origin import classify_origin
from app.modules.conversations.message_origin import OriginFacts, attach_origins, with_user_origin
from tests.conftest import patch_session_scope


# --- Clasificación pura ------------------------------------------------------

def test_a_flow_send_is_an_automation_with_its_execution():
    # La forma exacta la produce with_outbox_dedupe (test_automation_actions).
    origin = classify_origin(
        sender="vendedor", sent_by_user_id=None, has_outbox=True,
        dedupe_key="automation:63802:2:0:0",
    )
    assert origin == {"kind": "automation", "user_id": None, "execution_id": 63802}


def test_a_scheduled_send_is_credited_to_whoever_scheduled_it():
    origin = classify_origin(
        sender="vendedor", sent_by_user_id=9, has_outbox=True, dedupe_key="scheduled:41",
    )
    assert origin == {"kind": "scheduled", "user_id": 9, "execution_id": None}


def test_a_send_from_the_app_belongs_to_its_author():
    origin = classify_origin(sender="vendedor", sent_by_user_id=7, has_outbox=True, dedupe_key=None)
    assert origin == {"kind": "user", "user_id": 7, "execution_id": None}


def test_a_business_message_without_outbox_came_from_the_phone():
    """El eco del celular llega por webhook con sender=vendedor y nunca pasa
    por el outbox: esa ausencia es lo único que lo distingue."""
    origin = classify_origin(sender="vendedor", sent_by_user_id=None, has_outbox=False, dedupe_key=None)
    assert origin == {"kind": "echo", "user_id": None, "execution_id": None}


def test_an_old_app_send_without_author_is_still_from_the_app():
    """Antes de sent_by_user_id los envíos de la app salían sin acreditar.
    Siguen siendo de la app (pasaron por el outbox), solo que sin persona."""
    origin = classify_origin(sender="vendedor", sent_by_user_id=None, has_outbox=True, dedupe_key=None)
    assert origin == {"kind": "user", "user_id": None, "execution_id": None}


def test_customer_messages_have_no_origin():
    assert classify_origin(sender="cliente", sent_by_user_id=None, has_outbox=False, dedupe_key=None) is None


def test_a_malformed_automation_key_does_not_break_classification():
    origin = classify_origin(
        sender="vendedor", sent_by_user_id=None, has_outbox=True, dedupe_key="automation:oops",
    )
    assert origin == {"kind": "automation", "user_id": None, "execution_id": None}


# --- Enriquecimiento con nombres ---------------------------------------------

def _names(monkeypatch, directory: dict[int, str]):
    asked: list[set[int]] = []

    async def user_names(ids):
        wanted = set(ids)
        asked.append(wanted)
        return {user_id: directory[user_id] for user_id in wanted if user_id in directory}

    monkeypatch.setattr(message_origin, "user_names", user_names)
    return asked


@pytest.mark.asyncio
async def test_attach_origins_resolves_every_name_in_one_query(monkeypatch):
    asked = _names(monkeypatch, {7: "Grecia Geronimo", 9: "Antonella (inactiva)"})
    facts = {
        1: OriginFacts("vendedor", 7, True, None),
        2: OriginFacts("vendedor", 9, True, "scheduled:41"),
        3: OriginFacts("vendedor", None, True, "automation:63802:1:0:0"),
        4: OriginFacts("cliente", None, False, None),
    }

    items = await attach_origins([{"id": 1}, {"id": 2}, {"id": 3}, {"id": 4}], facts)

    assert [item["origin"] for item in items] == [
        {"kind": "user", "user_id": 7, "user_name": "Grecia Geronimo", "execution_id": None},
        {"kind": "scheduled", "user_id": 9, "user_name": "Antonella (inactiva)", "execution_id": None},
        {"kind": "automation", "user_id": None, "user_name": None, "execution_id": 63802},
        None,
    ]
    assert asked == [{7, 9}]


@pytest.mark.asyncio
async def test_attach_origins_loads_facts_by_id_when_not_given(monkeypatch):
    _names(monkeypatch, {})
    loaded: list[set[int]] = []

    async def load_origin_facts(message_ids):
        loaded.append(set(message_ids))
        return {5: OriginFacts("vendedor", None, False, None)}

    monkeypatch.setattr(message_origin, "load_origin_facts", load_origin_facts)

    items = await attach_origins([{"id": 5}, {"id": 6}])

    assert loaded == [{5, 6}]
    assert items[0]["origin"] == {"kind": "echo", "user_id": None, "user_name": None, "execution_id": None}
    # Sin hechos no se inventa nada.
    assert items[1]["origin"] is None


@pytest.mark.asyncio
async def test_attach_origins_with_nothing_to_do_touches_nothing(monkeypatch):
    asked = _names(monkeypatch, {})
    assert await attach_origins([]) == []
    assert asked == []


def test_a_fresh_send_is_signed_without_going_back_to_the_database():
    class FakeUser:
        id = 7
        name = "Grecia Geronimo"

    signed = with_user_origin({"id": 10, "content": "Hola"}, FakeUser())

    assert signed["origin"] == {
        "kind": "user", "user_id": 7, "user_name": "Grecia Geronimo", "execution_id": None,
    }
    assert signed["content"] == "Hola"


# --- El hilo trae los hechos en su propia consulta ---------------------------

@pytest.mark.asyncio
async def test_thread_query_carries_the_origin_facts(monkeypatch):
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

    patch_session_scope(monkeypatch, message_history, lambda: FakeSession)

    await message_history.fetch_messages("00000000-0000-0000-0000-000000000001")

    sql = str(statements[0].compile(
        dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True},
    ))
    assert "wsp_messages.sent_by_user_id" in sql
    assert "message_outbox.dedupe_key" in sql
    assert "message_outbox.id" in sql

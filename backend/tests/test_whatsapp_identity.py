from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from services import whatsapp_identity_service

from services.whatsapp_identity_service import (
    InvalidWhatsAppIdentityError,
    add_phone_jid,
    aliases_from_send_key,
    learn_send_aliases,
    parse_evolution_identity,
    resolve_history_jid,
    resolve_whatsapp_destination,
)

LEAD_ID = "7b08f4d9-855f-4718-b95f-9c021da52f77"


def _payload(key: dict, push_name: str = "Gerson P") -> dict:
    return {
        "instance": "dermicapro",
        "data": {"key": key, "pushName": push_name},
        # Es el número de la instancia, no el lead. Debe ignorarse siempre.
        "sender": "51974637783@s.whatsapp.net",
    }


def test_parse_lid_only_never_uses_sender_as_customer_phone():
    parsed = parse_evolution_identity(_payload({"remoteJid": "267692862898397@lid"}))

    assert parsed.instance == "dermicapro"
    assert parsed.jids == ("267692862898397@lid",)
    assert parsed.lid_jid == "267692862898397@lid"
    assert parsed.phone_jid is None
    assert parsed.push_name == "Gerson P"


def test_parse_phone_and_lid_aliases_deduplicates_values():
    parsed = parse_evolution_identity(_payload({
        "remoteJid": "267692862898397@lid",
        "remoteJidAlt": "51943663225@s.whatsapp.net",
        "participantAlt": "51943663225@s.whatsapp.net",
    }))

    assert parsed.jids == (
        "267692862898397@lid",
        "51943663225@s.whatsapp.net",
    )
    assert parsed.phone_jid == "51943663225@s.whatsapp.net"
    assert parsed.lid_jid == "267692862898397@lid"


@pytest.mark.parametrize("own_name", ["Você", "Voce", "DermicaPro"])
def test_outgoing_push_name_is_never_used_as_contact_name(own_name):
    parsed = parse_evolution_identity(_payload({
        "remoteJid": "51943663225@s.whatsapp.net",
        "fromMe": True,
    }, push_name=own_name))

    assert parsed.push_name is None


def test_accepts_complete_n8n_item_wrapper():
    parsed = parse_evolution_identity({
        "body": _payload({"remoteJid": "51943663225@s.whatsapp.net"})
    })

    assert parsed.phone_jid == "51943663225@s.whatsapp.net"


def test_group_event_is_not_converted_into_a_lead():
    with pytest.raises(InvalidWhatsAppIdentityError, match="grupo"):
        parse_evolution_identity(_payload({
            "remoteJid": "120363419787208859@g.us",
            "participant": "51943663225@s.whatsapp.net",
        }))


def test_external_contact_lookup_can_add_phone_without_changing_lid():
    original = parse_evolution_identity(_payload({"remoteJid": "267692862898397@lid"}))
    enriched = add_phone_jid(original, "51943663225@s.whatsapp.net")

    assert enriched.lid_jid == original.lid_jid
    assert enriched.phone_jid == "51943663225@s.whatsapp.net"
    assert enriched.jids == (
        "267692862898397@lid",
        "51943663225@s.whatsapp.net",
    )


def test_lid_digits_are_not_accepted_as_a_phone_lookup_result():
    original = parse_evolution_identity(_payload({"remoteJid": "267692862898397@lid"}))
    enriched = add_phone_jid(original, "267692862898397@lid")

    assert enriched == original


@pytest.mark.asyncio
async def test_destination_is_resolved_from_internal_lead_id(monkeypatch):
    session = type("Session", (), {})()
    session.scalar = AsyncMock(return_value="51943663225@s.whatsapp.net")

    class SessionContext:
        async def __aenter__(self):
            return session

        async def __aexit__(self, *_args):
            return False

    monkeypatch.setattr(
        whatsapp_identity_service,
        "get_sessionmaker",
        lambda: SessionContext,
    )
    monkeypatch.setattr(
        whatsapp_identity_service, "get_effective", AsyncMock(return_value="dermicapro")
    )

    assert await resolve_whatsapp_destination(LEAD_ID) == "51943663225@s.whatsapp.net"


# --- Alias aprendidos al enviar -------------------------------------------
#
# Con el direccionamiento por LID de WhatsApp, la respuesta de un envío es la
# única fuente que empareja el @lid de un contacto con su teléfono: los
# entrantes llegan solo con el LID y los contactos de Evolution no traen el
# número.

LID_JID = "269685694173263@lid"
PHONE_JID = "51997511558@s.whatsapp.net"
OTHER_LEAD_ID = "b1c2d3e4-0000-4000-8000-000000000000"


def _send_key(**extra) -> dict:
    return {"id": "3EB0BACE97A664E65339A5", "fromMe": True, **extra}


class _FakeResult:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


class _FakeSession:
    """Sesión mínima para ejercitar learn_send_aliases sin PostgreSQL."""

    def __init__(self, owners=None, lead=None):
        self.owners = owners or []
        self.lead = lead
        self.added = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return False

    # No hay transacción real: el mismo objeto sirve de contexto para begin().
    def begin(self):
        return self

    async def execute(self, _stmt):
        return _FakeResult(self.owners)

    def add(self, obj):
        self.added.append(obj)

    async def get(self, _model, _pk, **_kwargs):
        return self.lead


def _fake_db(monkeypatch, session):
    monkeypatch.setattr(
        whatsapp_identity_service, "get_sessionmaker", lambda: lambda: session
    )
    monkeypatch.setattr(
        whatsapp_identity_service, "get_effective", AsyncMock(return_value="dermicapro")
    )


def test_send_key_pairs_the_lid_with_the_phone():
    key = _send_key(
        remoteJid=LID_JID, remoteJidAlt=PHONE_JID, addressingMode="lid"
    )

    assert aliases_from_send_key(key) == (LID_JID, PHONE_JID)


@pytest.mark.parametrize(
    "key",
    [None, "no es un dict", {}, _send_key(remoteJid="120363419787208859@g.us")],
)
def test_send_key_without_usable_jids_is_ignored(key):
    assert aliases_from_send_key(key) == ()


@pytest.mark.asyncio
async def test_learn_registers_the_lid_used_for_the_chat(monkeypatch):
    """El caso que parte los chats: el lead solo conocía su teléfono."""
    session = _FakeSession(owners=[(PHONE_JID, LEAD_ID)])
    _fake_db(monkeypatch, session)

    learned = await learn_send_aliases(
        LEAD_ID, {"key": _send_key(remoteJid=LID_JID, remoteJidAlt=PHONE_JID)}
    )

    assert learned == (LID_JID,)
    assert [(a.jid, a.kind, a.lead_id) for a in session.added] == [
        (LID_JID, "lid", LEAD_ID)
    ]


@pytest.mark.asyncio
async def test_learn_does_not_steal_an_alias_from_another_lead(monkeypatch):
    """El LID ya es de un lead provisional: fusionar no le toca a un envío."""
    session = _FakeSession(owners=[(LID_JID, OTHER_LEAD_ID)])
    _fake_db(monkeypatch, session)

    learned = await learn_send_aliases(
        LEAD_ID, {"key": _send_key(remoteJid=LID_JID, remoteJidAlt=PHONE_JID)}
    )

    assert learned == (PHONE_JID,)
    assert [a.jid for a in session.added] == [PHONE_JID]


@pytest.mark.asyncio
async def test_learn_fills_the_phone_of_a_lead_born_from_a_lid(monkeypatch):
    lead = SimpleNamespace(telefono=None, updated_at=None)
    session = _FakeSession(owners=[(LID_JID, LEAD_ID)], lead=lead)
    _fake_db(monkeypatch, session)

    learned = await learn_send_aliases(
        LEAD_ID, {"key": _send_key(remoteJid=LID_JID, remoteJidAlt=PHONE_JID)}
    )

    assert learned == (PHONE_JID,)
    assert lead.telefono == "51997511558"


@pytest.mark.asyncio
async def test_history_is_asked_by_the_lid_that_evolution_indexes(monkeypatch):
    """Pedirlo por el teléfono devuelve cero registros con HTTP 200."""
    session = _FakeSession()
    session.scalar = AsyncMock(return_value=LID_JID)
    monkeypatch.setattr(
        whatsapp_identity_service, "get_sessionmaker", lambda: lambda: session
    )

    assert await resolve_history_jid(LEAD_ID) == LID_JID


@pytest.mark.asyncio
async def test_history_falls_back_to_the_phone_when_there_is_no_lid(monkeypatch):
    session = _FakeSession()
    # Sin alias LID; el respaldo lo resuelve resolve_whatsapp_destination.
    session.scalar = AsyncMock(side_effect=[None, PHONE_JID])
    monkeypatch.setattr(
        whatsapp_identity_service, "get_sessionmaker", lambda: lambda: session
    )
    monkeypatch.setattr(
        whatsapp_identity_service, "get_effective", AsyncMock(return_value="dermicapro")
    )

    assert await resolve_history_jid(LEAD_ID) == PHONE_JID


@pytest.mark.asyncio
async def test_learn_writes_nothing_when_both_aliases_are_known(monkeypatch):
    session = _FakeSession(owners=[(LID_JID, LEAD_ID), (PHONE_JID, LEAD_ID)])
    _fake_db(monkeypatch, session)

    learned = await learn_send_aliases(
        LEAD_ID, {"key": _send_key(remoteJid=LID_JID, remoteJidAlt=PHONE_JID)}
    )

    assert learned == ()
    assert session.added == []

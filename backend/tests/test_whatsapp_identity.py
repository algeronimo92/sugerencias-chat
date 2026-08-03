from unittest.mock import AsyncMock

import pytest

from services import whatsapp_identity_service

from services.whatsapp_identity_service import (
    InvalidWhatsAppIdentityError,
    add_phone_jid,
    parse_evolution_identity,
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

    assert await resolve_whatsapp_destination(LEAD_ID) == "51943663225@s.whatsapp.net"

"""Identidad del contacto con los identificadores exactos de Meta."""

from types import SimpleNamespace

import pytest

from app.integrations.whatsapp import identity as whatsapp_identity_service
from app.integrations.whatsapp.identity import (
    ContactIdentity,
    InvalidWhatsAppIdentityError,
    identity_from_echo,
    identity_from_inbound,
    resolve_whatsapp_destination,
)
from tests.meta_fixtures import PHONE_NUMBER_ID, inbound_cases


def test_inbound_takes_wa_id_user_id_and_profile_literally():
    case = inbound_cases()["text_with_user_id"]
    identity = identity_from_inbound(PHONE_NUMBER_ID, case["message"], [case["contact"]])

    assert identity == ContactIdentity(
        phone_number_id=PHONE_NUMBER_ID,
        wa_id="51955544433",
        user_id="PE.1084026510784249",
        profile_name="Rosa",
        username="rosa.p",
    )


def test_inbound_without_phone_keeps_only_the_user_id():
    case = inbound_cases()["text_user_id_only"]
    identity = identity_from_inbound(PHONE_NUMBER_ID, case["message"], [case["contact"]])

    assert identity.wa_id is None
    assert identity.user_id == "PE.1084026510784249"
    assert identity.aliases() == [("user_id", "PE.1084026510784249")]


def test_profile_of_another_contact_is_not_used():
    message = {"from": "51911111111", "id": "wamid.A", "type": "text", "text": {"body": "hola"}}
    other = {"profile": {"name": "Otra persona"}, "wa_id": "51922222222"}
    identity = identity_from_inbound(PHONE_NUMBER_ID, message, [other])

    assert identity.profile_name is None
    assert identity.wa_id == "51911111111"


def test_echo_identifies_the_recipient_and_never_the_business_profile():
    echo = {"from": "51999000111", "to": "51987654321", "to_user_id": "PE.1", "id": "wamid.E", "type": "text"}
    identity = identity_from_echo(PHONE_NUMBER_ID, echo)

    assert (identity.wa_id, identity.user_id, identity.profile_name) == ("51987654321", "PE.1", None)


def test_an_event_without_any_identifier_is_rejected():
    with pytest.raises(InvalidWhatsAppIdentityError):
        identity_from_inbound(PHONE_NUMBER_ID, {"id": "wamid.X", "type": "text"}, [])


class _Session:
    def __init__(self, rows):
        self.rows = rows

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return False

    async def execute(self, _statement):
        return SimpleNamespace(all=lambda: self.rows)


@pytest.mark.asyncio
async def test_destination_prefers_the_most_recent_identifier_of_each_kind(monkeypatch):
    rows = [("wa_id", "51900011122"), ("user_id", "PE.9"), ("wa_id", "51987654321")]
    monkeypatch.setattr(whatsapp_identity_service, "get_sessionmaker", lambda: lambda: _Session(rows))

    destination = await resolve_whatsapp_destination("lead-1")

    assert (destination.wa_id, destination.user_id) == ("51900011122", "PE.9")


@pytest.mark.asyncio
async def test_lead_without_identifiers_has_no_destination(monkeypatch):
    monkeypatch.setattr(whatsapp_identity_service, "get_sessionmaker", lambda: lambda: _Session([]))

    with pytest.raises(InvalidWhatsAppIdentityError):
        await resolve_whatsapp_destination("lead-1")

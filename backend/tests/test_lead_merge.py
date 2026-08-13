"""Unir las dos fichas en que el direccionamiento por LID parte una conversación.

El entrante llega solo con un ``@lid`` y crea un lead provisional con el
historial del cliente; el saliente va al JID telefónico y usa otro lead con el
teléfono y los datos comerciales. Fusionarlos tiene que juntar las dos mitades
sin pisar lo que ya cargó un vendedor.
"""

from types import SimpleNamespace

import pytest

from scripts.merge_lid_duplicates import _phone_from_records
from services.lead_merge import LeadMergeError, _fill_empty_fields, merge_leads

LID_JID = "269685694173263@lid"
PHONE_JID = "51997511558@s.whatsapp.net"


def _lead(**campos) -> SimpleNamespace:
    base = {
        "nombre": None,
        "telefono": None,
        "servicio_interes": None,
        "notas": None,
        "origen": None,
        "vendedor_id": None,
        "vendedor": None,
        "updated_at": None,
    }
    return SimpleNamespace(**{**base, **campos})


def test_the_target_adopts_only_what_it_has_empty():
    source = _lead(nombre="Dani 🌷", notas="vino del anuncio", vendedor_id=7)
    target = _lead(telefono="+51997511558", vendedor_id=3)

    completados = _fill_empty_fields(source, target)

    assert set(completados) == {"nombre", "notas"}
    assert target.nombre == "Dani 🌷"
    assert target.notas == "vino del anuncio"
    # El vendedor asignado en la ficha real no se toca.
    assert target.vendedor_id == 3
    assert target.telefono == "+51997511558"
    assert target.updated_at is not None


def test_nothing_is_copied_when_the_target_is_complete():
    source = _lead(nombre="Dani 🌷", telefono="+51900000000")
    target = _lead(nombre="Daniela", telefono="+51997511558")

    assert _fill_empty_fields(source, target) == ()
    assert target.nombre == "Daniela"
    assert target.updated_at is None


def test_the_phone_of_a_lead_born_from_a_lid_is_adopted():
    """El caso inverso: el huérfano es el destino y aporta el historial."""
    source = _lead(telefono="+51997511558")
    target = _lead(nombre="Dani 🌷")

    assert _fill_empty_fields(source, target) == ("telefono",)
    assert target.telefono == "+51997511558"


@pytest.mark.asyncio
async def test_a_lead_cannot_be_merged_into_itself():
    with pytest.raises(LeadMergeError, match="mismo lead"):
        await merge_leads("7b08f4d9-855f-4718-b95f-9c021da52f77",
                          "7b08f4d9-855f-4718-b95f-9c021da52f77")


# --- Descubrimiento del par ------------------------------------------------
#
# El teléfono de un huérfano solo aparece en la `key` de los mensajes que la
# app envió: Baileys resuelve ahí la equivalencia con el LID.


def _record(key: dict) -> dict:
    return {"key": key, "messageTimestamp": 1_700_000_000}


def test_the_phone_is_read_from_the_send_key():
    payload = {"messages": {"records": [
        _record({"id": "3AAA", "fromMe": False, "remoteJid": LID_JID}),
        _record({"id": "3EB0", "fromMe": True, "remoteJid": LID_JID,
                 "remoteJidAlt": PHONE_JID}),
    ]}}

    assert _phone_from_records(payload) == PHONE_JID


def test_a_chat_that_was_never_written_to_has_no_pair():
    payload = {"messages": {"records": [
        _record({"id": "3AAA", "fromMe": False, "remoteJid": LID_JID}),
    ]}}

    assert _phone_from_records(payload) is None


def test_a_lid_in_remote_jid_alt_is_not_taken_as_a_phone():
    payload = {"messages": {"records": [
        _record({"id": "3EB0", "remoteJid": LID_JID, "remoteJidAlt": "1234@lid"}),
    ]}}

    assert _phone_from_records(payload) is None


@pytest.mark.parametrize(
    "payload",
    [None, "error", {"error": "boom"}, [], {"messages": {"records": []}}],
)
def test_unexpected_shapes_do_not_break_the_lookup(payload):
    assert _phone_from_records(payload) is None


def test_a_bare_list_of_records_is_accepted():
    payload = [_record({"remoteJid": LID_JID, "remoteJidAlt": PHONE_JID})]

    assert _phone_from_records(payload) == PHONE_JID

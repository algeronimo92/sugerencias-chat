"""Unir las dos fichas en que el direccionamiento por LID parte una conversación.

El entrante llega solo con un ``@lid`` y crea un lead provisional con el
historial del cliente; el saliente va al JID telefónico y usa otro lead con el
teléfono y los datos comerciales. Fusionarlos tiene que juntar las dos mitades
sin pisar lo que ya cargó un vendedor.
"""

from types import SimpleNamespace

import pytest

import scripts.merge_lid_duplicates as merge_script
from scripts.merge_lid_duplicates import Candidate, Orphan, _phone_from_records
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
    target = _lead(telefono="51997511558", vendedor_id=3)

    completados = _fill_empty_fields(source, target)

    assert set(completados) == {"nombre", "notas"}
    assert target.nombre == "Dani 🌷"
    assert target.notas == "vino del anuncio"
    # El vendedor asignado en la ficha real no se toca.
    assert target.vendedor_id == 3
    assert target.telefono == "51997511558"
    assert target.updated_at is not None


def test_nothing_is_copied_when_the_target_is_complete():
    source = _lead(nombre="Dani 🌷", telefono="51900000000")
    target = _lead(nombre="Daniela", telefono="51997511558")

    assert _fill_empty_fields(source, target) == ()
    assert target.nombre == "Daniela"
    assert target.updated_at is None


def test_the_phone_of_a_lead_born_from_a_lid_is_adopted():
    """El caso inverso: el huérfano es el destino y aporta el historial."""
    source = _lead(telefono="51997511558")
    target = _lead(nombre="Dani 🌷")

    assert _fill_empty_fields(source, target) == ("telefono",)
    assert target.telefono == "51997511558"


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


# --- Qué hace --fusionar --todos con cada huérfano -------------------------
#
# Con Evolution retirado, un LID ya no se puede traducir a teléfono: el que no
# quede fusionado o con su teléfono adoptado antes del corte no se reconoce
# cuando la persona vuelve a escribir.

ORPHAN_ID = "7b08f4d9-855f-4718-b95f-9c021da52f77"
TARGET_ID = "0c1f4d6e-2a39-4b7e-9e55-3f1d2c8a6b10"


def _orphan(instance: str = "dermicapro") -> Orphan:
    return Orphan(ORPHAN_ID, "Dani 🌷", LID_JID, instance, 12)


async def _run_todos(monkeypatch, candidates: list[Candidate], *, apply: bool):
    merged, adopted = [], []

    async def fake_orphans():
        return [c.orphan for c in candidates]

    async def fake_candidates(orphans, concurrency):
        return candidates

    async def fake_merge(source, target, apply):
        merged.append((source, target, apply))
        return SimpleNamespace(summary=lambda: f"{source} -> {target}")

    async def fake_adopt(orphan, phone_jid, *, apply):
        adopted.append((orphan.lead_id, orphan.instance, phone_jid, apply))

    monkeypatch.setattr(merge_script, "_orphans", fake_orphans)
    monkeypatch.setattr(merge_script, "_candidates", fake_candidates)
    monkeypatch.setattr(merge_script, "merge_leads", fake_merge)
    monkeypatch.setattr(merge_script, "_adopt_phone", fake_adopt)

    args = merge_script.build_parser().parse_args(
        ["--fusionar", "--todos", *(["--apply"] if apply else [])]
    )
    await merge_script.run(args)
    return merged, adopted


@pytest.mark.asyncio
async def test_a_known_phone_without_a_lead_is_adopted_by_the_orphan(monkeypatch):
    merged, adopted = await _run_todos(
        monkeypatch, [Candidate(_orphan(), PHONE_JID, None, None)], apply=True
    )

    assert merged == []
    assert adopted == [(ORPHAN_ID, "dermicapro", PHONE_JID, True)]


@pytest.mark.asyncio
async def test_a_known_phone_with_a_lead_is_merged_not_adopted(monkeypatch):
    merged, adopted = await _run_todos(
        monkeypatch, [Candidate(_orphan(), PHONE_JID, TARGET_ID, "51997511558")], apply=True
    )

    assert merged == [(ORPHAN_ID, TARGET_ID, True)]
    assert adopted == []


@pytest.mark.asyncio
async def test_an_orphan_without_a_known_phone_is_left_alone(monkeypatch):
    merged, adopted = await _run_todos(
        monkeypatch, [Candidate(_orphan(), None, None, None)], apply=True
    )

    assert merged == []
    assert adopted == []


@pytest.mark.asyncio
async def test_a_lead_with_a_lid_in_two_instances_adopts_the_phone_once(monkeypatch):
    candidates = [
        Candidate(_orphan("dermicapro"), PHONE_JID, None, None),
        Candidate(_orphan("dermicaproventas"), PHONE_JID, None, None),
    ]

    _, adopted = await _run_todos(monkeypatch, candidates, apply=True)

    assert len(adopted) == 1


@pytest.mark.asyncio
async def test_without_apply_the_adoption_is_only_simulated(monkeypatch):
    _, adopted = await _run_todos(
        monkeypatch, [Candidate(_orphan(), PHONE_JID, None, None)], apply=False
    )

    assert adopted == [(ORPHAN_ID, "dermicapro", PHONE_JID, False)]

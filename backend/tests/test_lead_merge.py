"""Unir dos fichas de un mismo cliente en una sola.

Fusionar tiene que juntar lo que aporta cada lado sin pisar lo que ya cargó
un vendedor en el lead que sobrevive.
"""

from types import SimpleNamespace

import pytest

from services.lead_merge import LeadMergeError, _fill_empty_fields, merge_leads


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

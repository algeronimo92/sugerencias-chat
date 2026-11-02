"""Vínculo cita -> lead: la parte delicada es cuándo NO vincular.

Colgar una cita del lead equivocado es peor que dejarla sin vincular — el
vendedor abriría el chat de otra persona creyendo que es la que va a atender —,
así que el emparejamiento por teléfono solo se acepta cuando identifica a un
único lead. Que la consulta por cola de teléfono descarte dos candidatos se
prueba contra PostgreSQL en ``test_appointment_leads_postgres``.
"""

from unittest.mock import AsyncMock

import pytest

from app.modules.appointments.application import commands
from tests.appointment_fakes import in_memory_appointments  # noqa: F401


@pytest.fixture
def leads(in_memory_appointments, monkeypatch):
    monkeypatch.setattr(commands, "effective_country_code", AsyncMock(return_value="51"))
    return in_memory_appointments.leads


async def test_uses_the_whatsapp_alias_before_touching_the_phone(leads):
    """`whatsapp_identities` es la identidad canónica del CRM: si el número ya
    chateó, su ``wa_id`` manda y no hace falta comparar dígitos."""
    leads.identities["51987654321"] = "lead-canonico"

    assert await commands.resolve_lead_for_phone("987654321") == "lead-canonico"
    assert leads.tail_lookups == [], "no debía consultar leads teniendo el alias"


async def test_falls_back_to_the_phone_tail(leads):
    leads.tails["987654321"] = "lead-unico"

    assert await commands.resolve_lead_for_phone("+51 987 654 321") == "lead-unico"
    # Compara la cola del número, así el mismo celular escrito con o sin código
    # de país empareja igual.
    assert leads.tail_lookups == ["987654321"]


async def test_no_candidate_leaves_the_appointment_unlinked(leads):
    assert await commands.resolve_lead_for_phone("987654321") is None


async def test_an_unusable_phone_never_breaks_the_appointment(leads):
    """El registro de la cita es lo importante; resolver el lead es un extra que
    no puede tumbar el alta."""
    for phone in ("", "sin numero", "123"):
        assert await commands.resolve_lead_for_phone(phone) is None
    assert leads.tail_lookups == [], "un teléfono inválido no debería llegar a consultar"

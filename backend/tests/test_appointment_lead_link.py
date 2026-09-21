"""Vínculo cita -> lead: la parte delicada es cuándo NO vincular.

Colgar una cita del lead equivocado es peor que dejarla sin vincular — el
vendedor abriría el chat de otra persona creyendo que es la que va a atender —,
así que el emparejamiento por teléfono solo se acepta cuando identifica a un
único lead.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from sqlalchemy.dialects import postgresql

from services import appointment_service


class _SessionContext:
    def __init__(self, session):
        self._session = session

    async def __aenter__(self):
        return self._session

    async def __aexit__(self, *_args):
        return False


def _sessionmaker(session):
    return lambda: (lambda: _SessionContext(session))


class _Scalars:
    def __init__(self, values):
        self._values = values

    def scalars(self):
        return SimpleNamespace(all=lambda: self._values)


@pytest.fixture
def lead_matches(monkeypatch):
    """Devuelve los leads que la búsqueda por cola de teléfono encuentra, y deja
    ver el SQL con el que se buscaron."""
    statements: list[str] = []

    def configure(values):
        session = AsyncMock()

        async def execute(statement):
            statements.append(str(statement.compile(
                dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True},
            )))
            return _Scalars(values)

        session.execute = execute
        monkeypatch.setattr(appointment_service, "get_sessionmaker", _sessionmaker(session))
        return statements

    monkeypatch.setattr(appointment_service, "effective_country_code", AsyncMock(return_value="51"))
    return configure


@pytest.mark.asyncio
async def test_uses_the_whatsapp_alias_before_touching_the_phone(monkeypatch, lead_matches):
    """`whatsapp_identities` es la identidad canónica del CRM: si el número ya
    chateó, ese alias manda y no hace falta comparar dígitos."""
    statements = lead_matches([])
    monkeypatch.setattr(appointment_service, "effective_country_code", AsyncMock(return_value="51"))
    monkeypatch.setattr(appointment_service, "lead_id_for_jid", AsyncMock(return_value="lead-canonico"))

    assert await appointment_service.resolve_lead_for_phone("987654321") == "lead-canonico"
    assert statements == [], "no debía consultar leads teniendo el alias"


@pytest.mark.asyncio
async def test_falls_back_to_a_single_phone_match(monkeypatch, lead_matches):
    statements = lead_matches(["lead-unico"])
    monkeypatch.setattr(appointment_service, "lead_id_for_jid", AsyncMock(return_value=None))

    assert await appointment_service.resolve_lead_for_phone("+51 987 654 321") == "lead-unico"
    # Compara la cola del número, así el mismo celular escrito con o sin código
    # de país empareja igual.
    assert "987654321" in statements[0]


@pytest.mark.asyncio
async def test_two_candidates_leave_the_appointment_unlinked(monkeypatch, lead_matches):
    lead_matches(["lead-a", "lead-b"])
    monkeypatch.setattr(appointment_service, "lead_id_for_jid", AsyncMock(return_value=None))

    assert await appointment_service.resolve_lead_for_phone("987654321") is None


@pytest.mark.asyncio
async def test_no_candidate_leaves_the_appointment_unlinked(monkeypatch, lead_matches):
    lead_matches([])
    monkeypatch.setattr(appointment_service, "lead_id_for_jid", AsyncMock(return_value=None))

    assert await appointment_service.resolve_lead_for_phone("987654321") is None


@pytest.mark.asyncio
async def test_an_unusable_phone_never_breaks_the_appointment(monkeypatch, lead_matches):
    """El registro de la cita es lo importante; resolver el lead es un extra que
    no puede tumbar el alta."""
    statements = lead_matches([])
    monkeypatch.setattr(appointment_service, "lead_id_for_jid", AsyncMock(return_value=None))

    for phone in ("", "sin numero", "123"):
        assert await appointment_service.resolve_lead_for_phone(phone) is None
    assert statements == [], "un teléfono inválido no debería llegar a consultar"

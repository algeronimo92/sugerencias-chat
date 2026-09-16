from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from models.schemas import AppointmentCreate
from routers import appointments

SELLER = SimpleNamespace(id=7, role="vendedor")


def _body(**overrides):
    values = {
        "nombre_completo": "Ana Pérez",
        "telefono": "987654321",
        "tratamiento": "Botox",
        "fecha": "2026-10-01",
        "hora": "10:00",
        "vendedor": "Antonella",
        **overrides,
    }
    return AppointmentCreate(**values)


@pytest.fixture(autouse=True)
def team(monkeypatch):
    monkeypatch.setattr(appointments, "list_active_sellers", AsyncMock(return_value=[
        {"id": 1, "name": "Antonella", "role": "vendedor"},
        {"id": 2, "name": "Grecia", "role": "vendedor"},
    ]))
    monkeypatch.setattr(appointments, "effective_country_code", AsyncMock(return_value="51"))
    monkeypatch.setattr(appointments, "get_effective", AsyncMock(return_value=""))


async def test_a_seller_added_in_the_crm_needs_no_deploy(monkeypatch):
    """Antes la lista de vendedores estaba fija en el código."""
    monkeypatch.setattr(appointments, "list_active_sellers", AsyncMock(return_value=[
        {"id": 3, "name": "Vendedora Nueva", "role": "vendedor"},
    ]))

    with pytest.raises(HTTPException) as exc:
        await appointments.post_appointment(_body(vendedor="Vendedora Nueva"), SELLER)

    # Llega hasta la comprobación del webhook: el vendedor ya es válido.
    assert exc.value.status_code == 503


async def test_unknown_seller_is_rejected():
    with pytest.raises(HTTPException) as exc:
        await appointments.post_appointment(_body(vendedor="Alguien Más"), SELLER)

    assert exc.value.status_code == 400
    assert "usuario activo" in exc.value.detail


async def test_phone_follows_the_configured_country(monkeypatch):
    with pytest.raises(HTTPException) as exc:
        await appointments.post_appointment(_body(telefono="12345"), SELLER)
    assert exc.value.status_code == 400

    monkeypatch.setattr(appointments, "effective_country_code", AsyncMock(return_value="54"))
    with pytest.raises(HTTPException) as other:
        await appointments.post_appointment(_body(telefono="1123456789"), SELLER)
    # Un número argentino ya no es "teléfono peruano inválido": pasa la
    # validación y falla recién por el webhook sin configurar.
    assert other.value.status_code == 503


async def test_test_mode_is_admin_only():
    with pytest.raises(HTTPException) as exc:
        await appointments.post_appointment(_body(test_mode=True), SELLER)

    assert exc.value.status_code == 403

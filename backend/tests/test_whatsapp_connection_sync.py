"""El número por el que entran los webhooks vive en el plano de control.

`resolve_tenant_by_phone_number_id` lo lee antes de saber a qué schema pertenece
el evento, así que guardar las credenciales en el `app_settings` del negocio no
alcanza: sin esta fila activa, un webhook de Meta no encuentra su tenant.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest

import tenancy.provisioning as provisioning


ORGANIZATION_ID = UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
PHONE_NUMBER_ID = "1264142756787940"


class _FakeSession:
    def __init__(self, existing):
        self._existing = existing
        self.added = []

    async def execute(self, _statement):
        existing = self._existing

        class _Result:
            def scalars(self):
                return SimpleNamespace(first=lambda: existing)

        return _Result()

    def add(self, row):
        self.added.append(row)


@pytest.fixture
def control(monkeypatch):
    def _install(existing=None):
        session = _FakeSession(existing)

        @asynccontextmanager
        async def _control_session():
            yield session

        monkeypatch.setattr(provisioning, "control_session", _control_session)
        return session

    return _install


@pytest.mark.asyncio
async def test_crea_la_conexion_activa(control):
    session = control()

    await provisioning.sync_whatsapp_connection(
        ORGANIZATION_ID, phone_number_id=PHONE_NUMBER_ID, waba_id="2055264945090014"
    )

    (row,) = session.added
    assert row.organization_id == str(ORGANIZATION_ID)
    assert row.phone_number_id == PHONE_NUMBER_ID
    assert row.waba_id == "2055264945090014"
    # El CLI de aprovisionamiento la deja en "provisioning"; el ruteo solo mira
    # las activas, así que confirmar el número es lo que la habilita.
    assert row.status == "active"


@pytest.mark.asyncio
async def test_reactiva_la_conexion_existente_sin_duplicarla(control):
    existing = SimpleNamespace(
        organization_id=str(ORGANIZATION_ID),
        provider="meta",
        phone_number_id=PHONE_NUMBER_ID,
        waba_id="viejo",
        status="provisioning",
        updated_at=None,
    )
    session = control(existing)

    await provisioning.sync_whatsapp_connection(
        ORGANIZATION_ID, phone_number_id=PHONE_NUMBER_ID, waba_id="nuevo"
    )

    assert session.added == []
    assert existing.status == "active"
    assert existing.waba_id == "nuevo"


@pytest.mark.asyncio
async def test_conserva_el_waba_previo_si_no_llega_uno_nuevo(control):
    existing = SimpleNamespace(
        organization_id=str(ORGANIZATION_ID),
        provider="meta",
        phone_number_id=PHONE_NUMBER_ID,
        waba_id="2055264945090014",
        status="active",
        updated_at=None,
    )
    control(existing)

    await provisioning.sync_whatsapp_connection(
        ORGANIZATION_ID, phone_number_id=PHONE_NUMBER_ID
    )

    assert existing.waba_id == "2055264945090014"


@pytest.mark.asyncio
async def test_un_numero_de_otro_negocio_no_se_roba(control):
    """La columna es única: sin esta comprobación el choque llegaría como un
    IntegrityError que no dice cuál es el problema real."""
    control(
        SimpleNamespace(
            organization_id=str(uuid4()),
            provider="meta",
            phone_number_id=PHONE_NUMBER_ID,
            waba_id=None,
            status="active",
            updated_at=None,
        )
    )

    with pytest.raises(provisioning.WhatsAppConnectionConflictError):
        await provisioning.sync_whatsapp_connection(
            ORGANIZATION_ID, phone_number_id=PHONE_NUMBER_ID
        )


@pytest.mark.asyncio
async def test_exige_phone_number_id(control):
    control()

    with pytest.raises(ValueError):
        await provisioning.sync_whatsapp_connection(ORGANIZATION_ID, phone_number_id="  ")

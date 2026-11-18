"""Envío de las citas al ERP del negocio, con los conectores en memoria: la
cita local se guarda primero y un ERP caído solo la deja para reintentar."""

import base64
from types import SimpleNamespace
from unittest.mock import AsyncMock
from zoneinfo import ZoneInfo

import pytest

from app.core.errors import Invalid
from app.modules.appointments import api as appointments
from app.modules.appointments.application import calendar_template, commands, erp_sync
from app.modules.appointments.domain.errors import (
    DismissedAppointmentNotSentToErp,
    ErpDataRequired,
    ErpNotConfigured,
    ErpSyncFailed,
    TestAppointmentNotSentToErp,
)
from app.modules.appointments.schemas import (
    AppointmentCreate,
    ErpAppointmentsConfigUpdate,
    ErpAppointmentsTest,
)
from app.modules.platform.settings_service import validate_erp_base_url
from tests.appointment_fakes import in_memory_appointments  # noqa: F401

SELLER = SimpleNamespace(id=7, role="vendedor")
ADMIN = SimpleNamespace(id=1, role="admin")
PNG = b"\x89PNG\r\n\x1a\n-comprobante"

PACKAGES = [
    {"id": 10, "name": "x3", "sessions": 3, "position": 1, "external_id": "pkg-erp-3"},
    {"id": 11, "name": "Individual", "sessions": 1, "position": 0, "external_id": "pkg-erp-1"},
]


def _body(**overrides):
    return AppointmentCreate(**{
        "nombre_completo": "Rosa Quispe", "telefono": "987654321", "dni": "45678912",
        "tratamiento": "HIFU 12D - Rostro", "fecha": "2026-11-20", "hora": "15:30",
        "vendedor": "Grecia", **overrides,
    })


def _receipt():
    return {"content_type": "image/png", "filename": "yape.png", "data_base64": base64.b64encode(PNG).decode()}


@pytest.fixture(autouse=True)
def world(monkeypatch, in_memory_appointments):
    monkeypatch.setattr(appointments, "list_active_sellers", AsyncMock(return_value=[
        {"id": 3, "name": "Grecia", "role": "vendedor"},
    ]))
    monkeypatch.setattr(appointments, "effective_country_code", AsyncMock(return_value="51"))
    monkeypatch.setattr(commands, "effective_country_code", AsyncMock(return_value="51"))
    lima = AsyncMock(return_value=ZoneInfo("America/Lima"))
    monkeypatch.setattr(commands, "business_timezone", lima)
    monkeypatch.setattr(erp_sync, "business_timezone", lima)
    monkeypatch.setattr(appointments, "normalize_values", AsyncMock(side_effect=lambda _e, values, **_k: values))
    monkeypatch.setattr(calendar_template, "list_definitions", AsyncMock(return_value=[]))
    monkeypatch.setattr(calendar_template, "get_effective_many", AsyncMock(return_value={
        calendar_template.TITLE_KEY: "", calendar_template.DESCRIPTION_KEY: "",
    }))
    in_memory_appointments.erp.is_active = True
    in_memory_appointments.catalog.by_service["hifu 12d - rostro"] = PACKAGES
    in_memory_appointments.staff.emails["Grecia"] = "grecia@dermicapro.com"
    return in_memory_appointments


async def test_the_appointment_reaches_the_erp_after_being_saved(world):
    result = await appointments.post_appointment(_body(detalle="Viene por flacidez"), SELLER)

    assert world.repository.order == ["saved", "calendar", "erp", "n8n"]
    assert result["erpSyncStatus"] == "synced"
    assert result["integrationErrors"] == []
    appointment = result["appointment"]
    assert appointment["status"] == "created"
    assert appointment["erp_appointment_id"] == "erp-1"
    assert appointment["erp_link"] == "https://erp.example/appointments/erp-1"
    [sent] = world.erp.pushed
    assert sent["receipt"] is None
    assert sent["form"] == {
        "externalId": "negocio:41", "patientName": "Rosa Quispe", "patientDni": "45678912",
        "patientPhone": "987654321", "servicePackageId": "pkg-erp-1",
        "scheduledDate": "2026-11-20T15:30:00-05:00", "durationMinutes": "60",
        "sellerName": "Grecia", "sellerEmail": "grecia@dermicapro.com", "notes": "Viene por flacidez",
    }


async def test_without_a_choice_the_first_session_package_is_sent(world):
    result = await appointments.post_appointment(_body(), SELLER)

    assert (result["appointment"]["erp_package_id"], result["appointment"]["package_name"]) == (
        "pkg-erp-1", "Individual",
    )


async def test_the_chosen_package_is_sent(world):
    result = await appointments.post_appointment(_body(package_id=10), SELLER)

    assert result["appointment"]["package_name"] == "x3"
    assert world.erp.pushed[0]["form"]["servicePackageId"] == "pkg-erp-3"


async def test_the_deposit_travels_with_its_method_and_receipt(world):
    result = await appointments.post_appointment(
        _body(adelanto=50, payment_method="yape", comprobante=_receipt()), SELLER,
    )

    [sent] = world.erp.pushed
    assert sent["form"]["reservationAmount"] == "50.00"
    assert sent["form"]["reservationPaymentMethod"] == "yape"
    assert (sent["receipt"].filename, sent["receipt"].content, sent["receipt"].content_type) == (
        "yape.png", PNG, "image/png",
    )
    # El comprobante queda guardado: un reintento lo vuelve a mandar.
    assert result["appointment"]["comprobante_url"] == "/media/comprobante-1"
    assert result["appointment"]["payment_method"] == "yape"


@pytest.mark.parametrize(("overrides", "missing"), [
    ({"dni": ""}, "el DNI del cliente"),
    ({"dni": "123"}, "el DNI del cliente"),
    ({"adelanto": 50}, "el método de pago del adelanto"),
])
async def test_what_the_erp_requires_stops_the_appointment_before_saving(world, overrides, missing):
    with pytest.raises(ErpDataRequired) as exc:
        await appointments.post_appointment(_body(**overrides), SELLER)

    assert missing in exc.value.detail
    assert exc.value.status_code == 422
    assert world.repository.rows == {}
    assert world.erp.pushed == []


async def test_the_dni_can_come_from_the_business_custom_field(world):
    result = await appointments.post_appointment(_body(dni="", custom_fields={"dni": "45678912"}), SELLER)

    assert result["erpSyncStatus"] == "synced"
    assert world.erp.pushed[0]["form"]["patientDni"] == "45678912"


async def test_an_erp_failure_does_not_lose_the_appointment(world):
    world.erp.result = {"status": "error", "erp_appointment_id": None, "erp_link": None, "error": "El ERP no respondió a tiempo"}

    result = await appointments.post_appointment(_body(), SELLER)

    assert result["success"] is True
    assert result["appointment"]["status"] == "created_with_errors"
    assert result["appointment"]["erp_sync_status"] == "error"
    assert result["integrationErrors"] == ["ERP: El ERP no respondió a tiempo"]
    # n8n y el aviso siguen su curso aunque el ERP haya fallado.
    assert world.repository.order == ["saved", "calendar", "erp", "n8n"]


async def test_a_service_outside_the_erp_is_saved_and_marked_as_not_sent(world):
    result = await appointments.post_appointment(_body(tratamiento="Evaluación gratuita"), SELLER)

    assert result["success"] is True
    assert result["appointment"]["erp_sync_status"] == "error"
    assert "no tiene un paquete en el catálogo del ERP" in result["appointment"]["erp_sync_error"]
    assert world.erp.pushed == []


async def test_with_the_integration_off_nothing_changes(world):
    world.erp.is_active = False

    result = await appointments.post_appointment(_body(dni="", adelanto=50), SELLER)

    assert world.repository.order == ["saved", "calendar", "n8n"]
    assert result["erpSyncStatus"] == "not_configured"
    assert result["appointment"]["comprobante_url"] is None
    assert world.erp.pushed == []


async def test_a_test_appointment_never_goes_to_the_erp(world):
    result = await appointments.post_appointment(_body(dni="", test_mode=True), ADMIN)

    assert result["erpSyncStatus"] == "skipped"
    assert world.erp.pushed == []


async def test_the_seller_falls_back_to_whoever_registered_it(world):
    world.staff.emails.clear()
    world.staff.fallback_emails[SELLER.id] = "quien-registro@dermicapro.com"

    await appointments.post_appointment(_body(), SELLER)

    assert world.erp.pushed[0]["form"]["sellerEmail"] == "quien-registro@dermicapro.com"


async def test_retry_sends_the_saved_receipt_again(world):
    world.erp.result = {"status": "error", "erp_appointment_id": None, "erp_link": None, "error": "caído"}
    await appointments.post_appointment(_body(adelanto=50, payment_method="plin", comprobante=_receipt()), SELLER)
    world.erp.result = {
        "status": "synced", "erp_appointment_id": "erp-9", "erp_link": "https://erp.example/appointments/erp-9", "error": None,
    }

    synced = await appointments.sync_appointment_erp(41, SELLER)

    assert (synced["erp_sync_status"], synced["erp_appointment_id"], synced["erp_sync_error"]) == ("synced", "erp-9", None)
    retry = world.erp.pushed[-1]
    assert retry["form"]["externalId"] == "negocio:41"
    assert retry["receipt"].content == PNG


async def test_retry_is_a_no_op_once_synced(world):
    await appointments.post_appointment(_body(), SELLER)

    await appointments.sync_appointment_erp(41, SELLER)

    assert len(world.erp.pushed) == 1


async def test_retry_persists_the_error_before_reporting_it(world):
    world.erp.result = {"status": "error", "erp_appointment_id": None, "erp_link": None, "error": "primero"}
    await appointments.post_appointment(_body(), SELLER)
    world.erp.result = {"status": "error", "erp_appointment_id": None, "erp_link": None, "error": "El ERP rechazó el token"}

    with pytest.raises(ErpSyncFailed) as exc:
        await appointments.sync_appointment_erp(41, SELLER)

    # 409 y no 502: Cloudflare taparía el motivo.
    assert exc.value.status_code == 409
    assert exc.value.detail == "El ERP rechazó el token"
    assert world.repository.rows[41]["erp_sync_error"] == "El ERP rechazó el token"


async def test_retry_resolves_the_package_of_an_older_appointment(world):
    world.erp.is_active = False
    await appointments.post_appointment(_body(), SELLER)
    assert world.repository.rows[41]["erp_package_id"] is None
    world.erp.is_active = True

    synced = await appointments.sync_appointment_erp(41, SELLER)

    assert synced["erp_package_id"] == "pkg-erp-1"
    assert world.erp.pushed[0]["form"]["servicePackageId"] == "pkg-erp-1"


async def test_retry_refuses_what_must_not_be_sent(world):
    await appointments.post_appointment(_body(), SELLER)
    world.repository.rows[41]["erp_sync_status"] = "error"

    world.repository.rows[41]["dismissed_at"] = "2026-11-14T15:00:00Z"
    with pytest.raises(DismissedAppointmentNotSentToErp):
        await appointments.sync_appointment_erp(41, SELLER)

    world.repository.rows[41].update(dismissed_at=None, test_mode=True)
    with pytest.raises(TestAppointmentNotSentToErp):
        await appointments.sync_appointment_erp(41, SELLER)

    world.repository.rows[41]["test_mode"] = False
    world.erp.is_active = False
    with pytest.raises(ErpNotConfigured):
        await appointments.sync_appointment_erp(41, SELLER)


async def test_only_the_admin_sees_the_erp_address(world):
    world.erp.stored.update(enabled=True, url="https://erp.example", token_configured=True)

    for_seller = await appointments.get_erp_sync(SELLER)
    for_admin = await appointments.get_erp_sync(ADMIN)

    assert for_seller == {
        "active": True, "enabled": True, "url": None, "token_configured": True, "catalog_connected": True,
    }
    assert for_admin["url"] == "https://erp.example"


async def test_saving_keeps_the_token_when_it_comes_empty(world):
    world.erp.stored.update(token_configured=True)

    await appointments.put_erp_sync(
        ErpAppointmentsConfigUpdate(enabled=True, url="https://erp.example", token="  "), ADMIN,
    )

    assert world.erp.saved == [{"enabled": True, "url": "https://erp.example", "token": None}]


async def test_it_cannot_be_turned_on_without_address_or_token(world):
    with pytest.raises(Invalid):
        await appointments.put_erp_sync(ErpAppointmentsConfigUpdate(enabled=True, url="", token="t"), ADMIN)
    with pytest.raises(Invalid):
        await appointments.put_erp_sync(ErpAppointmentsConfigUpdate(enabled=True, url="https://erp.example"), ADMIN)
    assert world.erp.saved == []

    # Apagarlo no exige nada.
    await appointments.put_erp_sync(ErpAppointmentsConfigUpdate(enabled=False), ADMIN)
    assert world.erp.saved == [{"enabled": False, "url": "", "token": None}]


async def test_an_invalid_address_is_reported_as_such(world):
    world.erp.save_error = ValueError("La dirección del ERP debe empezar con http:// o https://")

    with pytest.raises(Invalid) as exc:
        await appointments.put_erp_sync(ErpAppointmentsConfigUpdate(enabled=True, url="erp.example", token="t"), ADMIN)

    assert "http://" in exc.value.detail


async def test_the_connection_test_uses_what_is_typed(world):
    result = await appointments.test_erp_sync(ErpAppointmentsTest(url="https://erp.example", token="nuevo"), ADMIN)

    assert result == {"ok": True, "error": None}
    assert world.erp.pings == [("https://erp.example", "nuevo")]


def test_the_erp_address_is_normalized():
    assert validate_erp_base_url("  https://erp.example/ ") == "https://erp.example"
    assert validate_erp_base_url("") == ""
    for invalid in ("erp.example", "ftp://erp.example", "https://erp.example/?token=1"):
        with pytest.raises(ValueError):
            validate_erp_base_url(invalid)

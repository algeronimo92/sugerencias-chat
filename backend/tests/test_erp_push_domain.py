"""Lo que la cita le manda al ERP: qué le falta, qué paquete lleva y cómo
viaja cada dato."""

from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from app.modules.appointments.domain.appointment import SyncResult, outcome
from app.modules.appointments.domain.erp_push import (
    choose_package,
    erp_appointment_link,
    erp_form,
    missing_for_erp,
)

LIMA = ZoneInfo("America/Lima")

APPOINTMENT = {
    "id": 41, "nombre_completo": "Rosa María Quispe Flores", "dni": "4567 8912", "telefono": "+51 987 654 321",
    "tratamiento": "HIFU 12D - Rostro", "detalle": "Viene por flacidez", "fecha": "2026-11-20", "hora": "15:30",
    "vendedor": "Grecia", "adelanto": 50.0, "payment_method": "yape", "duration_minutes": 45,
    "erp_package_id": "pkg-erp-3",
}

PACKAGES = [
    {"id": 10, "name": "x3", "sessions": 3, "position": 1, "external_id": "pkg-erp-3"},
    {"id": 11, "name": "Individual", "sessions": 1, "position": 0, "external_id": "pkg-erp-1"},
    {"id": 12, "name": "Promo local", "sessions": 1, "position": 2, "external_id": None},
]


@pytest.mark.parametrize("dni", ["45678912", "4567 8912", "45.678.912", "4567-8912"])
def test_an_eight_digit_dni_is_enough_without_deposit(dni):
    assert missing_for_erp(dni=dni, adelanto=0, payment_method=None) == []


@pytest.mark.parametrize("dni", ["", None, "1234567", "123456789", "CE001234"])
def test_the_erp_needs_an_eight_digit_dni(dni):
    assert missing_for_erp(dni=dni, adelanto=0, payment_method=None) == ["el DNI del cliente (8 dígitos)"]


def test_a_deposit_needs_its_payment_method():
    assert missing_for_erp(dni="45678912", adelanto=50, payment_method=None) == ["el método de pago del adelanto"]
    assert missing_for_erp(dni="45678912", adelanto=50, payment_method="account_credit") == [
        "el método de pago del adelanto",
    ]
    assert missing_for_erp(dni="45678912", adelanto=50, payment_method="yape") == []


def test_without_a_choice_the_package_with_fewer_sessions_goes():
    # El de 1 sesión cargado a mano no cuenta: no existe en el ERP.
    assert choose_package(PACKAGES, None)["external_id"] == "pkg-erp-1"


def test_the_chosen_package_is_respected():
    assert choose_package(PACKAGES, 10)["external_id"] == "pkg-erp-3"


def test_a_package_outside_the_erp_is_not_guessed():
    assert choose_package(PACKAGES, 12) is None
    assert choose_package(PACKAGES, 999) is None
    assert choose_package([PACKAGES[2]], None) is None
    assert choose_package([], None) is None


def test_the_form_carries_the_appointment_as_the_erp_reads_it():
    form = erp_form(
        APPOINTMENT, external_id="negocio:41",
        starts_at=datetime(2026, 11, 20, 15, 30, tzinfo=LIMA), seller_email="grecia@dermicapro.com",
    )

    assert form == {
        "externalId": "negocio:41",
        "patientName": "Rosa María Quispe Flores",
        "patientDni": "45678912",
        "patientPhone": "51987654321",
        "servicePackageId": "pkg-erp-3",
        # Con el offset de Lima: sin él la cita caería cinco horas corrida.
        "scheduledDate": "2026-11-20T15:30:00-05:00",
        "durationMinutes": "45",
        "sellerName": "Grecia",
        "sellerEmail": "grecia@dermicapro.com",
        "notes": "Viene por flacidez",
        "reservationAmount": "50.00",
        "reservationPaymentMethod": "yape",
    }


def test_without_deposit_no_payment_travels():
    form = erp_form(
        {**APPOINTMENT, "adelanto": 0, "detalle": ""}, external_id="negocio:41",
        starts_at=datetime(2026, 11, 20, 15, 30, tzinfo=LIMA), seller_email=None,
    )

    assert "reservationAmount" not in form
    assert "reservationPaymentMethod" not in form
    # Lo vacío no se manda: el ERP lo trata como ausente.
    assert "notes" not in form
    assert "sellerEmail" not in form


def test_the_link_opens_the_appointment_in_the_erp():
    assert erp_appointment_link("https://erp.example/", "abc") == "https://erp.example/appointments/abc"


def test_an_erp_error_is_reported_with_its_origin():
    calendar = {"status": "synced", "event_id": "e", "event_link": None, "error": None}
    erp = {"status": "error", "erp_appointment_id": None, "erp_link": None, "error": "El ERP no respondió a tiempo"}

    result = outcome(calendar, SyncResult(configured=False), None, erp)

    assert result.status == "created_with_errors"
    assert result.integration_errors == ["ERP: El ERP no respondió a tiempo"]
    assert outcome(calendar, SyncResult(configured=False), None, {**erp, "status": "synced"}).status == "created"

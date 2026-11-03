"""Lo que se le manda a n8n cuando el negocio pide DNI y adelanto como campos
personalizados en vez de los campos fijos del formulario."""

import json

from app.modules.appointments.domain.appointment import AppointmentRequest


def _request(**overrides) -> AppointmentRequest:
    values = {
        "nombre_completo": "Ana Pérez", "telefono": "987654321", "tratamiento": "HIFU",
        "fecha": "2026-11-04", "hora": "10:00", "vendedor": "Lucía",
    }
    values.update(overrides)
    return AppointmentRequest(**values)


def test_dni_and_adelanto_from_custom_fields_reach_the_fixed_fields():
    request = _request(custom_fields={"dni": "41479020", "adelanto": 30.0})

    form = request.n8n_form()

    assert form["DNI"] == "41479020"
    assert form["Adelanto"] == "30.0"
    assert json.loads(form["CamposPersonalizados"]) == {"dni": "41479020", "adelanto": 30.0}


def test_each_custom_field_travels_as_its_own_form_field():
    request = _request(custom_fields={"dni": "41479020", "adelanto": 30.0, "zona": "rostro", "promo": True})

    form = request.n8n_form()

    assert form["dni"] == "41479020"
    assert form["adelanto"] == "30.0"
    assert form["zona"] == "rostro"
    assert form["promo"] == "true"


def test_a_custom_field_never_overwrites_a_fixed_field():
    request = _request(custom_fields={"Fecha": "otra"})

    assert request.n8n_form()["Fecha"] == "2026-11-04"


def test_the_fixed_fields_win_when_both_are_filled():
    request = _request(dni="11111111", adelanto=50, custom_fields={"dni": "22222222", "adelanto": 30})

    form = request.n8n_form()

    assert form["DNI"] == "11111111"
    assert form["Adelanto"] == "50"


def test_the_saved_appointment_keeps_dni_and_adelanto_from_custom_fields():
    request = _request(custom_fields={"dni": "41479020", "adelanto": 30.0})

    record = request.record(created_by_user_id=1, lead_id=None)

    assert record["dni"] == "41479020"
    assert record["adelanto"] == 30.0


def test_without_custom_fields_nothing_changes():
    form = _request().n8n_form()

    assert form["DNI"] == ""
    assert form["Adelanto"] == "0"

"""Lectura de lo que llega a la agenda desde un CSV. Sin base de datos."""

from __future__ import annotations

import pytest

from app.modules.contacts.csv_reader import CsvFormatError, mapped_values, read_csv, suggest_mapping
from app.modules.contacts.normalization import (
    draft_from_csv_row, merge_tags, parse_consent, parse_tags, phone_from_meta,
)


# --- CSV -------------------------------------------------------------------

def test_excel_in_spanish_uses_semicolons_and_latin1():
    content = "Nombre;Celular;Correo\nMaría Pérez;987 654 321;maria@example.test\n".encode("cp1252")

    table = read_csv(content)

    assert table.headers == ["Nombre", "Celular", "Correo"]
    assert table.rows == [["María Pérez", "987 654 321", "maria@example.test"]]


def test_utf8_bom_and_blank_lines_are_ignored():
    table = read_csv("﻿name,phone\n\n,\nAna,+51987654321\n".encode("utf-8"))

    assert table.headers == ["name", "phone"]
    assert table.rows == [["Ana", "+51987654321"]]


@pytest.mark.parametrize("content, message", [
    (b"", "vacío"),
    (b"nombre,telefono\n", "no tiene filas"),
    (b"PK\x03\x04rest", "Excel"),
])
def test_unreadable_files_explain_what_to_do(content, message):
    with pytest.raises(CsvFormatError, match=message):
        read_csv(content)


def test_mapping_is_guessed_from_common_header_names():
    mapping = suggest_mapping(["Nombre completo", "Teléfono móvil", "E-mail", "Etiquetas", "Observaciones", "Otro"])

    assert mapping == {
        "nombre": 0, "telefono": 1, "email": 2, "etiquetas": 3, "notas": 4, "consentimiento": None,
    }


def test_mapped_values_tolerate_short_rows():
    assert mapped_values(["Ana"], {"nombre": 0, "telefono": 1}) == {"nombre": "Ana", "telefono": None}


# --- Normalización ---------------------------------------------------------

def test_csv_row_normalizes_a_local_number_with_the_country_code():
    draft = draft_from_csv_row({"nombre": "  Ana   Ruiz ", "telefono": "987 654 321", "etiquetas": "vip; botox"}, "51")

    assert draft.error is None
    assert draft.nombre == "Ana Ruiz"
    assert draft.telefono == "51987654321"
    assert draft.etiquetas == ["vip", "botox"]
    assert draft.dedupe_key == "p:51987654321"


@pytest.mark.parametrize("values, error", [
    ({"nombre": "Sin número"}, "Sin teléfono"),
    ({"telefono": "12"}, "Perú"),
    ({"telefono": "987654321", "email": "no-es-correo"}, "correo"),
])
def test_csv_rows_that_cannot_be_imported_say_why(values, error):
    assert error in (draft_from_csv_row(values, "51").error or "")


def test_tags_are_deduplicated_without_case():
    assert parse_tags("VIP, vip,  Botox |botox") == ["VIP", "Botox"]
    assert merge_tags(["vip"], ["VIP", "nuevo"]) == ["vip", "nuevo"]


@pytest.mark.parametrize("value, expected", [("Sí", True), ("x", True), ("no", False), (None, False)])
def test_consent_accepts_the_usual_spreadsheet_answers(value, expected):
    assert parse_consent(value) is expected


def test_meta_numbers_that_are_not_e164_are_dropped():
    assert phone_from_meta("+51 987 654 321") == "51987654321"
    assert phone_from_meta("123") is None

"""Los dos formatos de fecha de la API, y por qué no se pueden unificar.

Este test existe para frenar la "simplificación" obvia: son casi iguales, así
que tarde o temprano alguien va a querer dejar uno solo.
"""

from datetime import datetime, timezone

import pytest

from services.store.common import _fmt_ts, _parse_ts
from services.time_format import iso_utc, iso_utc_micros, parse_iso_utc_micros

EXACT_SECOND = datetime(2026, 9, 16, 12, 0, tzinfo=timezone.utc)
WITH_MICROS = datetime(2026, 9, 16, 12, 0, 0, 123456, tzinfo=timezone.utc)


def test_the_general_format_omits_microseconds_that_are_zero():
    assert iso_utc(EXACT_SECOND) == "2026-09-16T12:00:00Z"


def test_the_message_format_always_writes_them():
    assert iso_utc_micros(EXACT_SECOND) == "2026-09-16T12:00:00.000000Z"


def test_the_two_formats_disagree_on_purpose():
    assert iso_utc(EXACT_SECOND) != iso_utc_micros(EXACT_SECOND)


@pytest.mark.parametrize("formatter", [iso_utc, iso_utc_micros])
def test_none_stays_none(formatter):
    assert formatter(None) is None


def test_the_cursor_survives_the_round_trip():
    """El string que sale como cursor vuelve a entrar y tiene que reconstruir
    el mismo instante, microsegundos incluidos."""
    assert parse_iso_utc_micros(iso_utc_micros(WITH_MICROS)) == WITH_MICROS


def test_the_general_format_cannot_be_read_back_as_a_cursor():
    """La prueba de que unificarlos rompería la paginación: sin los seis
    dígitos, el parser del cursor no puede leer su propia salida."""
    with pytest.raises(ValueError):
        parse_iso_utc_micros(iso_utc(EXACT_SECOND))


def test_the_store_keeps_using_the_single_definition():
    assert _fmt_ts is iso_utc_micros
    assert _parse_ts is parse_iso_utc_micros

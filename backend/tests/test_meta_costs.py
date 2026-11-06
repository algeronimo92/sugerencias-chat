"""Lo que Meta cobra por WhatsApp y la ventana gratis por anuncio.

Desde el 2026-10-01 Meta cobra los mensajes de servicio pasados los 1.000
gratis del mes y las plantillas utility dentro de la ventana de 24 h. El monto
solo lo informa ``pricing_analytics``; la ventana por anuncio, el webhook de
estado.
"""

from datetime import date, datetime, timezone

from app.modules.conversations.domain.service_window import free_entry_point_expiry
from app.modules.platform.meta_costs import _rows, business_day

NOW = datetime(2026, 11, 6, 15, 0, tzinfo=timezone.utc)


def _status(origin_type: str | None, expiration) -> dict:
    status = {"id": "wamid.X", "status": "sent", "pricing": {"type": "free_entry_point", "category": "service"}}
    if origin_type is not None:
        status["conversation"] = {
            "id": "c1", "origin": {"type": origin_type}, "expiration_timestamp": expiration,
        }
    return status


def test_the_entry_point_window_comes_from_the_conversation_meta_reports():
    expires = free_entry_point_expiry(_status("referral_conversion", "1794441600"))

    assert expires == datetime(2026, 11, 12, 0, 0, tzinfo=timezone.utc)


def test_a_status_outside_an_ad_window_does_not_open_one():
    # Desde v24.0 Meta solo manda `conversation` dentro de la ventana por
    # anuncio; uno de otro origen (versiones viejas) no la abre.
    assert free_entry_point_expiry(_status("service", "1794441600")) is None
    assert free_entry_point_expiry(_status(None, None)) is None
    assert free_entry_point_expiry(_status("referral_conversion", "no-es-un-numero")) is None


def test_meta_days_are_the_business_local_date_not_the_utc_start():
    # Un día de Lima (UTC-5) arranca a las 05:00 UTC: sigue siendo ese día.
    start = datetime(2026, 11, 1, 5, 0, tzinfo=timezone.utc)
    end = datetime(2026, 11, 2, 5, 0, tzinfo=timezone.utc)
    assert business_day(start, end) == date(2026, 11, 1)
    # Y uno de UTC+8 arranca a las 16:00 UTC del día anterior.
    start = datetime(2026, 10, 31, 16, 0, tzinfo=timezone.utc)
    end = datetime(2026, 11, 1, 16, 0, tzinfo=timezone.utc)
    assert business_day(start, end) == date(2026, 11, 1)


def test_points_become_rows_and_repeated_combinations_add_up():
    points = [
        {"start": 1793509200, "end": 1793595600, "country": "PE", "pricing_type": "REGULAR",
         "pricing_category": "UTILITY", "volume": 2, "cost": 0.06, "tier": "0:250000"},
        {"start": 1793509200, "end": 1793595600, "country": "PE", "pricing_type": "REGULAR",
         "pricing_category": "UTILITY", "volume": 1, "cost": "0.03", "tier": "0:250000"},
        {"start": 1793509200, "end": 1793595600, "country": "PE", "pricing_type": "FREE_CUSTOMER_SERVICE",
         "pricing_category": "SERVICE", "volume": 40, "cost": 0},
        {"start": None, "end": 1793595600, "pricing_type": "REGULAR", "pricing_category": "SERVICE"},
    ]

    rows = _rows(points, "USD", NOW)

    assert len(rows) == 2
    utility = next(row for row in rows if row["pricing_category"] == "UTILITY")
    assert utility["day"] == date(2026, 11, 1)
    assert utility["volume"] == 3
    assert str(utility["cost"]) == "0.09"
    assert utility["currency"] == "USD"
    free = next(row for row in rows if row["pricing_category"] == "SERVICE")
    assert free["tier"] == "" and free["volume"] == 40

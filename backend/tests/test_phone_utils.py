import pytest

from services.phone_utils import (
    PhoneValidationError,
    digits_to_jid,
    jid_to_digits,
    normalize_phone,
)


def test_local_peru_number_gets_country_code():
    assert normalize_phone("906471403", "51") == "51906471403"


def test_formatted_local_number():
    assert normalize_phone("(906) 471-403", "51") == "51906471403"
    assert normalize_phone("906 471 403", "51") == "51906471403"


def test_plus_prefix_means_country_code_present():
    assert normalize_phone("+51 906 471 403", "51") == "51906471403"
    # Con "+" no se antepone nada aunque no empiece con el código default.
    assert normalize_phone("+54 9 11 1234-5678", "51") == "5491112345678"


def test_already_with_country_code_is_idempotent():
    assert normalize_phone("51906471403", "51") == "51906471403"
    assert normalize_phone(normalize_phone("906471403", "51"), "51") == "51906471403"


def test_other_default_country_code():
    assert normalize_phone("91112345678", "54") == "5491112345678"


def test_letters_rejected():
    with pytest.raises(PhoneValidationError):
        normalize_phone("abc", "51")
    with pytest.raises(PhoneValidationError):
        normalize_phone("906471403x", "51")


def test_empty_rejected():
    with pytest.raises(PhoneValidationError):
        normalize_phone("", "51")
    with pytest.raises(PhoneValidationError):
        normalize_phone("   ", "51")
    with pytest.raises(PhoneValidationError):
        normalize_phone("()- ", "51")


def test_too_short_and_too_long_rejected():
    with pytest.raises(PhoneValidationError):
        normalize_phone("+123", "51")
    with pytest.raises(PhoneValidationError):
        normalize_phone("9" * 20, "51")


def test_leading_zero_rejected():
    with pytest.raises(PhoneValidationError):
        normalize_phone("+051906471403", "51")


def test_invalid_default_country_code_falls_back():
    # Un default corrupto no puede romper el alta: cae al fallback 51.
    assert normalize_phone("906471403", "") == "51906471403"


def test_jid_roundtrip():
    assert digits_to_jid("51906471403") == "51906471403@s.whatsapp.net"
    assert jid_to_digits("51906471403@s.whatsapp.net") == "51906471403"

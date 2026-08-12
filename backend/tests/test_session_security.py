"""Invariantes que no requieren una base real del nuevo login."""

from services.session_service import (
    describe_device,
    hash_token,
    new_token,
    valid_login_pin,
    valid_pin,
    valid_token,
)


def test_session_tokens_have_256_bits_and_are_accepted() -> None:
    first = new_token()
    second = new_token()
    assert first != second
    assert len(first) == 43
    assert valid_token(first)
    assert valid_token(second)


def test_only_token_hash_is_stable_for_storage() -> None:
    token = new_token()
    digest = hash_token(token)
    assert len(digest) == 64
    assert token not in digest
    assert digest == hash_token(token)


def test_historical_jwt_and_malformed_cookie_are_rejected_before_database() -> None:
    assert not valid_token("no-es-un-jwt")
    assert not valid_token("eyJhbGciOiJIUzI1NiJ9.payload.signature")
    assert not valid_token("a" * 42)
    assert not valid_token("a" * 44)


def test_pin_is_exactly_four_ascii_digits() -> None:
    assert valid_pin("0123")
    assert not valid_pin("123")
    assert not valid_pin("12345")
    assert not valid_pin("123a")
    assert not valid_pin("１２３４")


def test_login_still_accepts_a_pin_created_when_eran_de_seis_digitos() -> None:
    """Acortar el PIN no puede dejar afuera a un dispositivo ya configurado: el
    filtro de entrada acepta el largo viejo y el bcrypt guardado decide."""
    assert valid_login_pin("0123")
    assert valid_login_pin("012345")
    assert not valid_login_pin("12345")
    assert not valid_login_pin("012345a")


def test_device_description_does_not_store_full_user_agent() -> None:
    user_agent = "Mozilla/5.0 (Linux; Android 15) AppleWebKit Chrome/140.0 Mobile"
    assert describe_device(user_agent) == "Chrome en Android"

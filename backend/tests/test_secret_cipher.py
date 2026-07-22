import base64

import pytest

from services import secret_cipher


@pytest.fixture
def dedicated_key(monkeypatch):
    encoded = base64.urlsafe_b64encode(bytes(range(32))).decode("ascii")
    monkeypatch.setattr(secret_cipher.settings, "settings_encryption_key", encoded)
    monkeypatch.setattr(secret_cipher.settings, "secret_key", "jwt-key-for-tests")
    return encoded


def test_secret_round_trip_uses_ciphertext(dedicated_key):
    encrypted = secret_cipher.encrypt_secret("evolution_api_key", "super-secret")

    assert encrypted.startswith(secret_cipher.ENCRYPTED_PREFIX)
    assert "super-secret" not in encrypted
    assert secret_cipher.decrypt_secret("evolution_api_key", encrypted) == "super-secret"
    assert not secret_cipher.needs_reencryption("evolution_api_key", encrypted)


def test_ciphertext_is_bound_to_setting_key(dedicated_key):
    encrypted = secret_cipher.encrypt_secret("evolution_api_key", "super-secret")

    with pytest.raises(secret_cipher.SecretCipherError):
        secret_cipher.decrypt_secret("n8n_webhook_token", encrypted)


def test_modified_ciphertext_is_rejected(dedicated_key):
    encrypted = secret_cipher.encrypt_secret("evolution_api_key", "super-secret")
    replacement = "A" if encrypted[-2] != "A" else "B"
    tampered = encrypted[:-2] + replacement + encrypted[-1]

    with pytest.raises(secret_cipher.SecretCipherError):
        secret_cipher.decrypt_secret("evolution_api_key", tampered)


def test_plaintext_is_marked_for_migration(dedicated_key):
    assert secret_cipher.decrypt_secret("evolution_api_key", "legacy-secret") == "legacy-secret"
    assert secret_cipher.needs_reencryption("evolution_api_key", "legacy-secret")


def test_fallback_ciphertext_can_rotate_to_dedicated_key(monkeypatch):
    monkeypatch.setattr(secret_cipher.settings, "settings_encryption_key", "")
    monkeypatch.setattr(secret_cipher.settings, "secret_key", "jwt-key-for-tests")
    old_ciphertext = secret_cipher.encrypt_secret("evolution_api_key", "legacy-secret")

    new_key = base64.urlsafe_b64encode(b"x" * 32).decode("ascii")
    monkeypatch.setattr(secret_cipher.settings, "settings_encryption_key", new_key)

    assert secret_cipher.decrypt_secret("evolution_api_key", old_ciphertext) == "legacy-secret"
    assert secret_cipher.needs_reencryption("evolution_api_key", old_ciphertext)

"""Cifrado autenticado para secretos persistidos en ``app_settings``.

El prefijo permite distinguir ciphertext de valores históricos en texto plano.
La clave nunca se guarda en PostgreSQL: proviene de SETTINGS_ENCRYPTION_KEY o,
para compatibilidad inicial, se deriva de SECRET_KEY con separación de dominio.
"""

import base64
import binascii
import hashlib
import os

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from config import settings

ENCRYPTED_PREFIX = "enc:v1:"
_KEY_CONTEXT = b"dermicapro:app-settings:v1\x00"


class SecretCipherError(RuntimeError):
    pass


def _decode_explicit_key(value: str) -> bytes:
    cleaned = value.strip()
    if not cleaned:
        raise SecretCipherError("SETTINGS_ENCRYPTION_KEY está vacía")
    try:
        padded = cleaned + "=" * (-len(cleaned) % 4)
        decoded = base64.urlsafe_b64decode(padded.encode("ascii"))
    except (ValueError, UnicodeEncodeError, binascii.Error) as exc:
        raise SecretCipherError(
            "SETTINGS_ENCRYPTION_KEY debe ser base64-url de 32 bytes"
        ) from exc
    if len(decoded) != 32:
        raise SecretCipherError(
            "SETTINGS_ENCRYPTION_KEY debe decodificar exactamente 32 bytes"
        )
    return decoded


def _fallback_key() -> bytes:
    # La separación de dominio evita reutilizar directamente la clave JWT.
    return hashlib.sha256(_KEY_CONTEXT + settings.secret_key.encode("utf-8")).digest()


def _primary_key() -> bytes:
    if settings.settings_encryption_key.strip():
        return _decode_explicit_key(settings.settings_encryption_key)
    return _fallback_key()


def _aad(setting_key: str) -> bytes:
    # Vincula cada ciphertext a su fila: copiarlo a otra key no lo descifra.
    return f"app_settings:{setting_key}:v1".encode("utf-8")


def is_encrypted(value: str | None) -> bool:
    return bool(value and value.startswith(ENCRYPTED_PREFIX))


def encrypt_secret(setting_key: str, plaintext: str) -> str:
    nonce = os.urandom(12)
    ciphertext = AESGCM(_primary_key()).encrypt(
        nonce,
        plaintext.encode("utf-8"),
        _aad(setting_key),
    )
    token = base64.urlsafe_b64encode(nonce + ciphertext).decode("ascii")
    return ENCRYPTED_PREFIX + token


def _decrypt_with(key: bytes, setting_key: str, value: str) -> str:
    try:
        token = value[len(ENCRYPTED_PREFIX):]
        raw = base64.urlsafe_b64decode(token.encode("ascii"))
        if len(raw) < 12 + 16:
            raise ValueError("ciphertext incompleto")
        plaintext = AESGCM(key).decrypt(raw[:12], raw[12:], _aad(setting_key))
        return plaintext.decode("utf-8")
    except (InvalidTag, ValueError, UnicodeDecodeError, binascii.Error) as exc:
        raise SecretCipherError(
            f"No se pudo descifrar la configuración sensible '{setting_key}'"
        ) from exc


def decrypt_secret(setting_key: str, value: str) -> str:
    if not is_encrypted(value):
        # Compatibilidad exclusiva para la migración automática de filas viejas.
        return value

    primary = _primary_key()
    try:
        return _decrypt_with(primary, setting_key, value)
    except SecretCipherError as primary_error:
        fallback = _fallback_key()
        if fallback == primary:
            raise
        try:
            return _decrypt_with(fallback, setting_key, value)
        except SecretCipherError:
            raise primary_error


def needs_reencryption(setting_key: str, value: str) -> bool:
    """True para texto plano o ciphertext hecho con la clave de compatibilidad."""
    if not is_encrypted(value):
        return True
    try:
        _decrypt_with(_primary_key(), setting_key, value)
        return False
    except SecretCipherError:
        # Valida que al menos sea legible con la clave anterior antes de rotar.
        _decrypt_with(_fallback_key(), setting_key, value)
        return True

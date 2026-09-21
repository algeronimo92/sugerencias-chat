"""Verificación del webhook de Meta (challenge de suscripción y firma HMAC).

n8n sigue recibiendo la llamada cruda de Meta, pero reenvía el challenge y la
firma acá para no tener que guardar ``meta_verify_token``/``meta_app_secret``
como variable de entorno propia (su plan no lo permite). El secreto vive una
sola vez, en la configuración del backend.
"""

from __future__ import annotations

import hashlib
import hmac

from services.platform_settings import platform_setting


async def verify_challenge(mode: str | None, token: str | None) -> bool:
    expected = await platform_setting("meta_verify_token")
    if not expected:
        raise RuntimeError("meta_verify_token no esta configurado")
    return mode == "subscribe" and token is not None and hmac.compare_digest(token, expected)


async def verify_signature(raw_body: bytes, signature_header: str | None) -> bool:
    secret = await platform_setting("meta_app_secret")
    if not secret:
        raise RuntimeError("meta_app_secret no esta configurado")
    if not signature_header or not signature_header.lower().startswith("sha256="):
        return False
    expected = "sha256=" + hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(signature_header.lower(), expected.lower())

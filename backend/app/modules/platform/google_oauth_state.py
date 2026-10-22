"""El ``state`` firmado del flujo "Conectar con Google".

El callback de Google llega a una URL única para todos los negocios, fuera de
su dominio: el negocio se resuelve desde este token y no desde el host. Lleva
un nonce que el negocio guarda y el callback consume, así que un state solo
sirve una vez, y del nonce sale el ``code_verifier`` de PKCE sin tener que
guardarlo aparte.
"""

from __future__ import annotations

import base64
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import json
import secrets
from uuid import UUID

from app.core.config import settings

STATE_TTL = timedelta(minutes=10)
_KEY_CONTEXT = b"dermicapro:google-oauth-state:v1\x00"
_VERIFIER_CONTEXT = b"pkce-verifier\x00"


class InvalidOAuthState(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class OAuthState:
    # None en instalaciones single-tenant: no hay organización que resolver.
    organization_id: UUID | None
    user_id: int
    nonce: str
    # Origen del CRM desde el que se inició el flujo (ya validado contra los
    # dominios del negocio): adonde vuelve el callback.
    return_origin: str
    expires_at: datetime


def _b64encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _b64decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _signing_key() -> bytes:
    # Separación de dominio: SECRET_KEY firma sesiones; esto no debe poder
    # pasar por una ni al revés.
    return hashlib.sha256(_KEY_CONTEXT + settings.secret_key.encode("utf-8")).digest()


def _sign(encoded: str) -> str:
    return _b64encode(hmac.new(_signing_key(), encoded.encode("ascii"), hashlib.sha256).digest())


def new_nonce() -> str:
    return secrets.token_urlsafe(24)


def code_verifier(nonce: str) -> str:
    # 43 caracteres base64-url: el mínimo que acepta RFC 7636.
    return _b64encode(hmac.new(_signing_key(), _VERIFIER_CONTEXT + nonce.encode("ascii"), hashlib.sha256).digest())


def code_challenge(nonce: str) -> str:
    return _b64encode(hashlib.sha256(code_verifier(nonce).encode("ascii")).digest())


def issue_state(
    organization_id: UUID | None,
    user_id: int,
    nonce: str,
    return_origin: str,
    *,
    now: datetime | None = None,
) -> str:
    expires_at = (now or datetime.now(timezone.utc)) + STATE_TTL
    payload = {
        "v": 1,
        "org": str(organization_id) if organization_id else None,
        "uid": user_id,
        "n": nonce,
        "o": return_origin,
        "exp": int(expires_at.timestamp()),
    }
    encoded = _b64encode(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8"))
    return f"{encoded}.{_sign(encoded)}"


def decode_state(token: str, *, now: datetime | None = None) -> OAuthState:
    try:
        encoded, signature = token.split(".", 1)
        if not hmac.compare_digest(signature, _sign(encoded)):
            raise ValueError("firma")
        payload = json.loads(_b64decode(encoded))
        if payload.get("v") != 1:
            raise ValueError("versión")
        state = OAuthState(
            organization_id=UUID(payload["org"]) if payload.get("org") else None,
            user_id=int(payload["uid"]),
            nonce=str(payload["n"]),
            return_origin=str(payload["o"]),
            expires_at=datetime.fromtimestamp(int(payload["exp"]), tz=timezone.utc),
        )
    except (KeyError, TypeError, ValueError, UnicodeError, json.JSONDecodeError) as exc:
        raise InvalidOAuthState("state inválido") from exc
    if state.expires_at <= (now or datetime.now(timezone.utc)):
        raise InvalidOAuthState("state vencido")
    return state

"""Pure policies and value types shared by cases and atomic persistence."""
from __future__ import annotations
import hashlib
import re
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from time import monotonic
from app.core.config import settings
from app.db.models.auth import User
from app.tenancy.context import get_current_tenant

SESSION_TOUCH_INTERVAL = timedelta(minutes=5)

TOKEN_PATTERN = re.compile(r"^[A-Za-z0-9_-]{43}$")

_session_cache: dict[tuple[str | None, str], tuple[float, "SessionResolution"]] = {}

class PinInvalidError(Exception):
    pass

class PinLockedError(Exception):
    def __init__(self, retry_after_seconds: int):
        self.retry_after_seconds = retry_after_seconds

@dataclass(frozen=True)
class CreatedSession:
    token: str
    session_id: str
    absolute_expires_at: datetime
    persistent: bool

@dataclass(frozen=True)
class SessionResolution:
    user: User
    session_id: str
    absolute_expires_at: datetime
    persistent: bool
    auth_method: str
    idle_expires_at: datetime
    rotated_token: str | None = None

@dataclass(frozen=True)
class TrustedDeviceResult:
    device_id: str
    token: str
    expires_at: datetime

def utcnow() -> datetime:
    return datetime.now(timezone.utc)

def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()

def new_token() -> str:
    return secrets.token_urlsafe(32)

def valid_token(token: str) -> bool:
    """Descarta basura sin consultar PostgreSQL.

    Los tokens se generan con 32 bytes y token_urlsafe produce 43 caracteres
    sin padding. También evita que cookies históricas (JWT) disparen queries.
    """
    return bool(TOKEN_PATTERN.fullmatch(token))

PIN_LENGTH = 4

LEGACY_PIN_LENGTHS = frozenset({4, 6})

def valid_pin(pin: str) -> bool:
    """Largo exigido al configurar un PIN nuevo."""
    return len(pin) == PIN_LENGTH and pin.isascii() and pin.isdigit()

def valid_login_pin(pin: str) -> bool:
    """Largo aceptado al entrar. Más permisivo que `valid_pin` a propósito: es
    solo un filtro barato antes de tocar la base, quien decide sigue siendo el
    bcrypt del PIN guardado."""
    return len(pin) in LEGACY_PIN_LENGTHS and pin.isascii() and pin.isdigit()

def invalidate_session_cache(*, user_id: int | None = None, session_id: str | None = None) -> None:
    context = get_current_tenant()
    organization_id = str(context.organization_id) if context else None
    if user_id is None and session_id is None:
        for key in [key for key in _session_cache if key[0] == organization_id]:
            _session_cache.pop(key, None)
        return
    for cache_key, (_, resolved) in list(_session_cache.items()):
        if cache_key[0] != organization_id:
            continue
        if (user_id is not None and resolved.user.id == user_id) or (
            session_id is not None and resolved.session_id == session_id
        ):
            _session_cache.pop(cache_key, None)

def _cached_resolution(digest: str) -> SessionResolution | None:
    context = get_current_tenant()
    cache_key = (str(context.organization_id) if context else None, digest)
    cached = _session_cache.get(cache_key)
    if cached is None:
        return None
    cache_expires_at, resolved = cached
    now = utcnow()
    if (
        monotonic() >= cache_expires_at
        or resolved.idle_expires_at <= now
        or resolved.absolute_expires_at <= now
    ):
        _session_cache.pop(cache_key, None)
        return None
    return resolved

def _cache_resolution(digest: str, resolved: SessionResolution) -> None:
    # Nunca se cachea la instrucción de rotar la cookie: Set-Cookie debe salir
    # una sola vez. El token nuevo sí queda listo para las siguientes requests.
    cached = SessionResolution(
        user=resolved.user,
        session_id=resolved.session_id,
        absolute_expires_at=resolved.absolute_expires_at,
        persistent=resolved.persistent,
        auth_method=resolved.auth_method,
        idle_expires_at=resolved.idle_expires_at,
        rotated_token=None,
    )
    context = get_current_tenant()
    cache_key = (str(context.organization_id) if context else None, digest)
    _session_cache[cache_key] = (
        monotonic() + max(0.0, settings.auth_user_cache_ttl_seconds),
        cached,
    )

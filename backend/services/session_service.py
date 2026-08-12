"""Sesiones de usuario y dispositivos confiables.

Los tokens que llegan al navegador son aleatorios. PostgreSQL sólo conserva
SHA-256, de modo que una lectura accidental de la tabla no permite reutilizar
sesiones. El PIN está ligado además al token secreto del dispositivo.
"""

from __future__ import annotations

import hashlib
import re
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from time import monotonic
from uuid import uuid4

import bcrypt
from sqlalchemy import or_, select, update

from config import settings
from db.models import AuthSession, TrustedDevice, User
from db.session import get_sessionmaker


SESSION_TOUCH_INTERVAL = timedelta(minutes=5)
TOKEN_PATTERN = re.compile(r"^[A-Za-z0-9_-]{43}$")
_session_cache: dict[str, tuple[float, "SessionResolution"]] = {}


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
# Los PIN viejos eran de 6 dígitos. Al configurar uno nuevo se exige el largo
# actual, pero al entrar se aceptan los dos: si no, un dispositivo que ya tenía
# PIN de 6 quedaba sin poder entrar con él hasta volver a configurarlo desde
# otra sesión — y para eso hay que entrar primero.
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
    if user_id is None and session_id is None:
        _session_cache.clear()
        return
    for digest, (_, resolved) in list(_session_cache.items()):
        if (user_id is not None and resolved.user.id == user_id) or (
            session_id is not None and resolved.session_id == session_id
        ):
            _session_cache.pop(digest, None)


def _cached_resolution(digest: str) -> SessionResolution | None:
    cached = _session_cache.get(digest)
    if cached is None:
        return None
    cache_expires_at, resolved = cached
    now = utcnow()
    if (
        monotonic() >= cache_expires_at
        or resolved.idle_expires_at <= now
        or resolved.absolute_expires_at <= now
    ):
        _session_cache.pop(digest, None)
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
    _session_cache[digest] = (
        monotonic() + max(0.0, settings.auth_user_cache_ttl_seconds),
        cached,
    )


def describe_device(user_agent: str | None) -> str:
    ua = user_agent or ""
    if "Edg/" in ua:
        browser = "Edge"
    elif "Firefox/" in ua:
        browser = "Firefox"
    elif "CriOS/" in ua or "Chrome/" in ua:
        browser = "Chrome"
    elif "Safari/" in ua:
        browser = "Safari"
    else:
        browser = "Navegador"

    if "iPhone" in ua or "iPad" in ua:
        platform = "iPhone/iPad"
    elif "Android" in ua:
        platform = "Android"
    elif "Windows" in ua:
        platform = "Windows"
    elif "Macintosh" in ua:
        platform = "Mac"
    elif "Linux" in ua:
        platform = "Linux"
    else:
        platform = "este dispositivo"
    return f"{browser} en {platform}"[:120]


async def create_session(
    user_id: int,
    *,
    persistent: bool,
    auth_method: str,
    device_name: str,
    trusted_device_id: str | None = None,
) -> CreatedSession:
    now = utcnow()
    if persistent:
        idle_expires_at = now + timedelta(hours=settings.session_idle_hours)
        absolute_expires_at = now + timedelta(hours=settings.session_absolute_hours)
    else:
        idle_expires_at = now + timedelta(hours=settings.session_ephemeral_idle_hours)
        absolute_expires_at = now + timedelta(hours=settings.session_ephemeral_absolute_hours)
    idle_expires_at = min(idle_expires_at, absolute_expires_at)
    token = new_token()
    session_id = str(uuid4())
    row = AuthSession(
        id=session_id,
        user_id=user_id,
        trusted_device_id=trusted_device_id,
        token_hash=hash_token(token),
        previous_token_hash=None,
        previous_token_valid_until=None,
        auth_method=auth_method,
        persistent=persistent,
        created_at=now,
        last_used_at=now,
        idle_expires_at=idle_expires_at,
        absolute_expires_at=absolute_expires_at,
        rotated_at=now,
        revoked_at=None,
        device_name=device_name,
    )
    async with get_sessionmaker()() as db:
        db.add(row)
        await db.commit()
    return CreatedSession(token, session_id, absolute_expires_at, persistent)


async def resolve_session(token: str | None, *, rotate: bool = True) -> SessionResolution | None:
    if not token or not valid_token(token):
        return None
    digest = hash_token(token)
    cached = _cached_resolution(digest)
    if cached is not None:
        return cached
    now = utcnow()
    stmt = (
        select(AuthSession, User)
        .join(User, User.id == AuthSession.user_id)
        .where(or_(AuthSession.token_hash == digest, AuthSession.previous_token_hash == digest))
    )
    async with get_sessionmaker()() as db:
        row = (await db.execute(stmt)).one_or_none()
        if row is None:
            return None
        auth_session, user = row
        is_current_token = secrets.compare_digest(auth_session.token_hash, digest)
        previous_is_valid = (
            not is_current_token
            and auth_session.previous_token_hash is not None
            and secrets.compare_digest(auth_session.previous_token_hash, digest)
            and auth_session.previous_token_valid_until is not None
            and auth_session.previous_token_valid_until > now
        )
        expired = auth_session.idle_expires_at <= now or auth_session.absolute_expires_at <= now
        if auth_session.revoked_at is not None or expired or not user.is_active or not (is_current_token or previous_is_valid):
            if auth_session.revoked_at is None and (expired or not user.is_active):
                await db.execute(
                    update(AuthSession).where(AuthSession.id == auth_session.id).values(revoked_at=now)
                )
                await db.commit()
            return None

        values: dict = {}
        if now - auth_session.last_used_at >= SESSION_TOUCH_INTERVAL:
            idle_hours = settings.session_idle_hours if auth_session.persistent else settings.session_ephemeral_idle_hours
            values["last_used_at"] = now
            values["idle_expires_at"] = min(
                now + timedelta(hours=idle_hours), auth_session.absolute_expires_at
            )

        rotated_token: str | None = None
        rotation_due = now - auth_session.rotated_at >= timedelta(hours=settings.session_rotation_hours)
        if rotate and is_current_token and rotation_due:
            candidate = new_token()
            values.update(
                token_hash=hash_token(candidate),
                previous_token_hash=auth_session.token_hash,
                previous_token_valid_until=now + timedelta(
                    seconds=settings.session_previous_token_grace_seconds
                ),
                rotated_at=now,
            )
            result = await db.execute(
                update(AuthSession)
                .where(AuthSession.id == auth_session.id, AuthSession.token_hash == digest)
                .values(**values)
            )
            if result.rowcount:
                rotated_token = candidate
            await db.commit()
        elif values:
            await db.execute(update(AuthSession).where(AuthSession.id == auth_session.id).values(**values))
            await db.commit()

        resolved = SessionResolution(
            user=user,
            session_id=auth_session.id,
            absolute_expires_at=auth_session.absolute_expires_at,
            persistent=auth_session.persistent,
            auth_method=auth_session.auth_method,
            idle_expires_at=values.get("idle_expires_at", auth_session.idle_expires_at),
            rotated_token=rotated_token,
        )
        if rotated_token:
            _cache_resolution(hash_token(rotated_token), resolved)
        elif is_current_token:
            _cache_resolution(digest, resolved)
        return resolved


async def revoke_session_token(token: str | None) -> None:
    if not token or not valid_token(token):
        return
    digest = hash_token(token)
    async with get_sessionmaker()() as db:
        result = await db.execute(
            update(AuthSession)
            .where(or_(AuthSession.token_hash == digest, AuthSession.previous_token_hash == digest))
            .values(revoked_at=utcnow())
            .returning(AuthSession.id)
        )
        session_ids = list(result.scalars())
        await db.commit()
    for session_id in session_ids:
        invalidate_session_cache(session_id=session_id)


async def revoke_all_for_user(user_id: int, *, include_devices: bool = True) -> None:
    now = utcnow()
    async with get_sessionmaker()() as db:
        await db.execute(
            update(AuthSession)
            .where(AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None))
            .values(revoked_at=now)
        )
        if include_devices:
            await db.execute(
                update(TrustedDevice)
                .where(TrustedDevice.user_id == user_id, TrustedDevice.revoked_at.is_(None))
                .values(revoked_at=now)
            )
        await db.commit()
    invalidate_session_cache(user_id=user_id)


async def register_trusted_device(
    user_id: int,
    *,
    current_token: str | None,
    device_name: str,
) -> TrustedDeviceResult:
    now = utcnow()
    expires_at = now + timedelta(hours=settings.trusted_device_expire_hours)
    if current_token and valid_token(current_token):
        digest = hash_token(current_token)
        async with get_sessionmaker()() as db:
            device = (
                await db.execute(
                    select(TrustedDevice).where(
                        TrustedDevice.token_hash == digest,
                        TrustedDevice.user_id == user_id,
                        TrustedDevice.revoked_at.is_(None),
                        TrustedDevice.expires_at > now,
                    )
                )
            ).scalar_one_or_none()
            if device is not None:
                await db.execute(
                    update(TrustedDevice)
                    .where(TrustedDevice.id == device.id)
                    .values(name=device_name, last_used_at=now, expires_at=expires_at)
                )
                await db.commit()
                return TrustedDeviceResult(device.id, current_token, expires_at)

    token = new_token()
    device_id = str(uuid4())
    row = TrustedDevice(
        id=device_id,
        user_id=user_id,
        token_hash=hash_token(token),
        pin_hash=None,
        name=device_name,
        failed_pin_attempts=0,
        locked_until=None,
        created_at=now,
        last_used_at=now,
        expires_at=expires_at,
        revoked_at=None,
    )
    async with get_sessionmaker()() as db:
        db.add(row)
        await db.commit()
    return TrustedDeviceResult(device_id, token, expires_at)


async def configure_pin(
    user_id: int,
    *,
    device_token: str | None,
    pin: str,
    device_name: str,
) -> TrustedDeviceResult:
    if not valid_pin(pin):
        raise ValueError(f"El PIN debe tener exactamente {PIN_LENGTH} dígitos")
    device = await register_trusted_device(
        user_id, current_token=device_token, device_name=device_name
    )
    pin_hash = bcrypt.hashpw(pin.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    async with get_sessionmaker()() as db:
        await db.execute(
            update(TrustedDevice)
            .where(TrustedDevice.id == device.device_id, TrustedDevice.user_id == user_id)
            .values(pin_hash=pin_hash, failed_pin_attempts=0, locked_until=None)
        )
        await db.commit()
    return device


async def pin_status(device_token: str | None) -> dict:
    if not device_token or not valid_token(device_token):
        return {"available": False}
    now = utcnow()
    stmt = (
        select(TrustedDevice, User)
        .join(User, User.id == TrustedDevice.user_id)
        .where(
            TrustedDevice.token_hash == hash_token(device_token),
            TrustedDevice.revoked_at.is_(None),
            TrustedDevice.expires_at > now,
            TrustedDevice.pin_hash.is_not(None),
            User.is_active.is_(True),
        )
    )
    async with get_sessionmaker()() as db:
        row = (await db.execute(stmt)).one_or_none()
    if row is None:
        return {"available": False}
    device, user = row
    locked_seconds = 0
    if device.locked_until and device.locked_until > now:
        locked_seconds = max(1, int((device.locked_until - now).total_seconds()))
    local, _, domain = user.email.partition("@")
    masked_email = f"{local[:2]}***@{domain}" if domain else ""
    return {
        "available": True,
        "user_name": user.name,
        "masked_email": masked_email,
        "device_name": device.name,
        "locked_seconds": locked_seconds,
    }


async def authenticate_pin(device_token: str | None, pin: str) -> tuple[User, TrustedDeviceResult]:
    if not device_token or not valid_token(device_token) or not valid_login_pin(pin):
        raise PinInvalidError()
    now = utcnow()
    digest = hash_token(device_token)
    async with get_sessionmaker()() as db:
        stmt = (
            select(TrustedDevice, User)
            .join(User, User.id == TrustedDevice.user_id)
            .where(TrustedDevice.token_hash == digest)
            .with_for_update()
        )
        row = (await db.execute(stmt)).one_or_none()
        if row is None:
            raise PinInvalidError()
        device, user = row
        if (
            device.revoked_at is not None
            or device.expires_at <= now
            or device.pin_hash is None
            or not user.is_active
        ):
            raise PinInvalidError()
        if device.locked_until and device.locked_until > now:
            raise PinLockedError(max(1, int((device.locked_until - now).total_seconds())))
        if device.locked_until and device.locked_until <= now:
            device.failed_pin_attempts = 0
            device.locked_until = None

        if not bcrypt.checkpw(pin.encode("utf-8"), device.pin_hash.encode("utf-8")):
            attempts = device.failed_pin_attempts + 1
            device.failed_pin_attempts = attempts
            if attempts >= settings.pin_max_attempts:
                device.locked_until = now + timedelta(minutes=settings.pin_lock_minutes)
                retry_after = settings.pin_lock_minutes * 60
                await db.commit()
                raise PinLockedError(retry_after)
            await db.commit()
            raise PinInvalidError()

        rotated_device_token = new_token()
        expires_at = now + timedelta(hours=settings.trusted_device_expire_hours)
        device.token_hash = hash_token(rotated_device_token)
        device.failed_pin_attempts = 0
        device.locked_until = None
        device.last_used_at = now
        device.expires_at = expires_at
        await db.commit()
        return user, TrustedDeviceResult(device.id, rotated_device_token, expires_at)


async def remove_pin(user_id: int, device_token: str | None) -> bool:
    if not device_token or not valid_token(device_token):
        return False
    async with get_sessionmaker()() as db:
        result = await db.execute(
            update(TrustedDevice)
            .where(
                TrustedDevice.user_id == user_id,
                TrustedDevice.token_hash == hash_token(device_token),
                TrustedDevice.revoked_at.is_(None),
            )
            .values(pin_hash=None, failed_pin_attempts=0, locked_until=None)
        )
        await db.commit()
        return result.rowcount > 0


async def forget_trusted_device(user_id: int, device_token: str | None) -> bool:
    """Revoca el dispositivo actual cuando se desmarca "Recordarme"."""
    if not device_token or not valid_token(device_token):
        return False
    now = utcnow()
    async with get_sessionmaker()() as db:
        result = await db.execute(
            update(TrustedDevice)
            .where(
                TrustedDevice.user_id == user_id,
                TrustedDevice.token_hash == hash_token(device_token),
                TrustedDevice.revoked_at.is_(None),
            )
            .values(revoked_at=now)
            .returning(TrustedDevice.id)
        )
        device_ids = list(result.scalars())
        if device_ids:
            sessions = await db.execute(
                update(AuthSession)
                .where(
                    AuthSession.user_id == user_id,
                    AuthSession.trusted_device_id.in_(device_ids),
                    AuthSession.revoked_at.is_(None),
                )
                .values(revoked_at=now)
                .returning(AuthSession.id)
            )
            session_ids = list(sessions.scalars())
        else:
            session_ids = []
        await db.commit()
    for session_id in session_ids:
        invalidate_session_cache(session_id=session_id)
    return bool(device_ids)


async def list_user_sessions(user_id: int, current_session_id: str) -> list[dict]:
    now = utcnow()
    stmt = (
        select(AuthSession)
        .where(
            AuthSession.user_id == user_id,
            AuthSession.revoked_at.is_(None),
            AuthSession.idle_expires_at > now,
            AuthSession.absolute_expires_at > now,
        )
        .order_by(AuthSession.last_used_at.desc())
    )
    async with get_sessionmaker()() as db:
        rows = (await db.execute(stmt)).scalars().all()
    return [
        {
            "id": item.id,
            "device_name": item.device_name,
            "auth_method": item.auth_method,
            "current": item.id == current_session_id,
            "created_at": item.created_at,
            "last_used_at": item.last_used_at,
            "absolute_expires_at": item.absolute_expires_at,
        }
        for item in rows
    ]


async def revoke_user_session(user_id: int, session_id: str) -> bool:
    async with get_sessionmaker()() as db:
        result = await db.execute(
            update(AuthSession)
            .where(
                AuthSession.id == session_id,
                AuthSession.user_id == user_id,
                AuthSession.revoked_at.is_(None),
            )
            .values(revoked_at=utcnow())
        )
        await db.commit()
        removed = result.rowcount > 0
    if removed:
        invalidate_session_cache(session_id=session_id)
    return removed

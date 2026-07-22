import asyncio
from datetime import datetime, timedelta, timezone
from time import monotonic

import bcrypt
import jwt
from fastapi import Depends, HTTPException, Request

from config import settings
from db.models import User

COOKIE_NAME = "access_token"
JWT_ALGORITHM = "HS256"
_user_cache: dict[int, tuple[float, User | None]] = {}
_user_cache_lock = asyncio.Lock()


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))


def create_access_token(user_id: int) -> str:
    expires_at = datetime.now(timezone.utc) + timedelta(hours=settings.access_token_expire_hours)
    payload = {"sub": str(user_id), "exp": expires_at}
    return jwt.encode(payload, settings.secret_key, algorithm=JWT_ALGORITHM)


def decode_access_token(token: str) -> int | None:
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[JWT_ALGORITHM])
        return int(payload["sub"])
    except (jwt.InvalidTokenError, KeyError, ValueError):
        return None


def invalidate_user_cache(user_id: int | None = None) -> None:
    if user_id is None:
        _user_cache.clear()
    else:
        _user_cache.pop(user_id, None)


async def _cached_user(user_id: int) -> User | None:
    now = monotonic()
    cached = _user_cache.get(user_id)
    if cached is not None and now < cached[0]:
        return cached[1]

    async with _user_cache_lock:
        now = monotonic()
        cached = _user_cache.get(user_id)
        if cached is not None and now < cached[0]:
            return cached[1]
        from services.db_service import get_user_by_id  # evita ciclo

        user = await get_user_by_id(user_id)
        if user is not None and not user.is_active:
            user = None
        _user_cache[user_id] = (
            now + max(0.0, settings.auth_user_cache_ttl_seconds),
            user,
        )
        return user


async def get_user_from_token(token: str | None) -> User | None:
    """Valida el JWT y refresca rol/estado con una caché corta.

    Las mutaciones de usuarios invalidan localmente la entrada, y otros
    workers convergen dentro del TTL configurado.
    """
    if not token:
        return None
    user_id = decode_access_token(token)
    if user_id is None:
        return None

    return await _cached_user(user_id)


async def get_current_user(request: Request) -> User:
    user = await get_user_from_token(request.cookies.get(COOKIE_NAME))
    if user is None:
        raise HTTPException(status_code=401, detail="No autenticado")
    return user


async def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Requiere permisos de administrador")
    return user

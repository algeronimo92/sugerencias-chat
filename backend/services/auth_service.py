from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, HTTPException, Request

from config import settings
from db.models import User

COOKIE_NAME = "access_token"
JWT_ALGORITHM = "HS256"


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


async def _user_from_token(token: str | None) -> User | None:
    """Rol y is_active se leen siempre de la DB (no del JWT): así, si un admin
    desactiva o degrada a alguien, el efecto es inmediato en vez de esperar a
    que expire el token."""
    if not token:
        return None
    user_id = decode_access_token(token)
    if user_id is None:
        return None

    from services.db_service import get_user_by_id  # import diferido: evita ciclo con db_service

    user = await get_user_by_id(user_id)
    if user is None or not user.is_active:
        return None
    return user


async def get_current_user(request: Request) -> User:
    user = await _user_from_token(request.cookies.get(COOKIE_NAME))
    if user is None:
        raise HTTPException(status_code=401, detail="No autenticado")
    return user


async def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Requiere permisos de administrador")
    return user

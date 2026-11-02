"""Sesiones de usuario y dispositivos confiables.

Los tokens que llegan al navegador son aleatorios. PostgreSQL sólo conserva
SHA-256, de modo que una lectura accidental de la tabla no permite reutilizar
sesiones. El PIN está ligado además al token secreto del dispositivo.
"""

from __future__ import annotations
from app.modules.auth import session_repository
from app.modules.auth.session_policies import (CreatedSession, LEGACY_PIN_LENGTHS, PIN_LENGTH, PinInvalidError, PinLockedError, SESSION_TOUCH_INTERVAL, SessionResolution, TOKEN_PATTERN, TrustedDeviceResult, _cache_resolution, _cached_resolution, _session_cache, hash_token, invalidate_session_cache, new_token, utcnow, valid_login_pin, valid_pin, valid_token)

import hashlib
import re
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from time import monotonic
from uuid import uuid4

import bcrypt

from app.core.config import settings
from app.db.models.auth import AuthSession, TrustedDevice, User
from app.tenancy.context import get_current_tenant


# Los PIN viejos eran de 6 dígitos. Al configurar uno nuevo se exige el largo
# actual, pero al entrar se aceptan los dos: si no, un dispositivo que ya tenía
# PIN de 6 quedaba sin poder entrar con él hasta volver a configurarlo desde
# otra sesión — y para eso hay que entrar primero.


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


async def create_session(user_id: int, *, persistent: bool, auth_method: str, device_name: str, trusted_device_id: str | None=None) -> CreatedSession:
    return await session_repository.create_session(user_id, persistent=persistent, auth_method=auth_method, device_name=device_name, trusted_device_id=trusted_device_id)


async def resolve_session(token: str | None, *, rotate: bool=True) -> SessionResolution | None:
    return await session_repository.resolve_session(token, rotate=rotate)


async def revoke_session_token(token: str | None) -> None:
    return await session_repository.revoke_session_token(token)


async def revoke_all_sessions_in_current_tenant() -> None:
    return await session_repository.revoke_all_sessions_in_current_tenant()


async def revoke_all_for_user(user_id: int, *, include_devices: bool=True) -> None:
    return await session_repository.revoke_all_for_user(user_id, include_devices=include_devices)


async def register_trusted_device(user_id: int, *, current_token: str | None, device_name: str) -> TrustedDeviceResult:
    return await session_repository.register_trusted_device(user_id, current_token=current_token, device_name=device_name)


async def configure_pin(user_id: int, *, device_token: str | None, pin: str, device_name: str) -> TrustedDeviceResult:
    return await session_repository.configure_pin(user_id, device_token=device_token, pin=pin, device_name=device_name)


async def pin_status(device_token: str | None) -> dict:
    return await session_repository.pin_status(device_token)


async def authenticate_pin(device_token: str | None, pin: str) -> tuple[User, TrustedDeviceResult]:
    return await session_repository.authenticate_pin(device_token, pin)


async def remove_pin(user_id: int, device_token: str | None) -> bool:
    return await session_repository.remove_pin(user_id, device_token)


async def forget_trusted_device(user_id: int, device_token: str | None) -> bool:
    return await session_repository.forget_trusted_device(user_id, device_token)


async def list_user_sessions(user_id: int, current_session_id: str) -> list[dict]:
    return await session_repository.list_user_sessions(user_id, current_session_id)


async def revoke_user_session(user_id: int, session_id: str) -> bool:
    return await session_repository.revoke_user_session(user_id, session_id)

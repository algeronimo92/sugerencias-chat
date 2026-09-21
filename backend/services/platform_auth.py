"""Sesiones del panel de plataforma, separadas de las del CRM.

Un operador de plataforma no es usuario de ningún negocio: vive en
`public.platform_users` y su sesión en `public.platform_sessions`, con una
cookie propia. Así, comprometer el CRM de un cliente no acerca a nadie al panel
que administra a todos (docs/multi-tenant-saas-plan.md sección 5.2).

A propósito es más simple que `session_service`: sin dispositivos de confianza,
sin PIN y sin rotación de token. Son pocas sesiones, cortas y de gente con
permisos amplios — conviene poca superficie y expiración agresiva.
"""

from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, Request
from sqlalchemy import select

from db.models import PlatformSession, PlatformUser
from db.session import control_session
from services.auth_service import hash_password, verify_password


PLATFORM_COOKIE_NAME = "platform_session"
SESSION_HOURS = 12

# Hash real de una contraseña aleatoria: se compara contra él cuando el correo
# no existe, para que fallar por usuario inexistente cueste lo mismo que fallar
# por contraseña incorrecta y no se puedan enumerar operadores por tiempos.
_DUMMY_HASH = hash_password(secrets.token_urlsafe(32))


def _hash_token(token: str) -> str:
    # El token nunca se guarda en claro: si alguien lee la tabla, no puede
    # hacerse pasar por un operador con lo que encontró.
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


async def authenticate(email: str, password: str) -> str | None:
    """Devuelve un token de sesión nuevo, o None si las credenciales no valen."""

    normalized = email.strip().lower()
    async with control_session() as session:
        user = (
            await session.execute(
                select(PlatformUser).where(PlatformUser.email == normalized)
            )
        ).scalars().first()
        password_hash = user.password_hash if user else _DUMMY_HASH
        try:
            valid = verify_password(password, password_hash)
        except ValueError:
            # Hash corrupto en la fila: se trata como credencial inválida en vez
            # de devolver un 500 que además delataría que el usuario existe.
            valid = False
        if user is None or not valid or not user.is_active:
            return None

        token = secrets.token_urlsafe(48)
        now = datetime.now(timezone.utc)
        session.add(
            PlatformSession(
                platform_user_id=user.id,
                token_hash=_hash_token(token),
                created_at=now,
                last_used_at=now,
                expires_at=now + timedelta(hours=SESSION_HOURS),
            )
        )
        user.last_login_at = now
    return token


async def resolve_platform_session(token: str | None) -> PlatformUser | None:
    if not token:
        return None
    now = datetime.now(timezone.utc)
    async with control_session() as session:
        row = (
            await session.execute(
                select(PlatformSession, PlatformUser)
                .join(PlatformUser, PlatformUser.id == PlatformSession.platform_user_id)
                .where(
                    PlatformSession.token_hash == _hash_token(token),
                    PlatformSession.revoked_at.is_(None),
                    PlatformSession.expires_at > now,
                    PlatformUser.is_active.is_(True),
                )
            )
        ).one_or_none()
        if row is None:
            return None
        platform_session, user = row
        platform_session.last_used_at = now
        return user


async def revoke_platform_session(token: str | None) -> None:
    if not token:
        return
    async with control_session() as session:
        platform_session = (
            await session.execute(
                select(PlatformSession).where(
                    PlatformSession.token_hash == _hash_token(token),
                    PlatformSession.revoked_at.is_(None),
                )
            )
        ).scalars().first()
        if platform_session is not None:
            platform_session.revoked_at = datetime.now(timezone.utc)


async def get_current_platform_user(request: Request) -> PlatformUser:
    user = await resolve_platform_session(request.cookies.get(PLATFORM_COOKIE_NAME))
    if user is None:
        raise HTTPException(status_code=401, detail="No autenticado")
    return user

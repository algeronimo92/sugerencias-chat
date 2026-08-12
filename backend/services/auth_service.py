import logging
import secrets

import bcrypt
from fastapi import Depends, Header, HTTPException, Request, Response

from config import settings
from db.models import User
from services.session_service import invalidate_session_cache, resolve_session

logger = logging.getLogger(__name__)

COOKIE_NAME = "access_token"
DEVICE_COOKIE_NAME = "trusted_device"


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))


def invalidate_user_cache(user_id: int | None = None) -> None:
    """Invalida la caché corta de sesiones al cambiar rol o estado."""
    invalidate_session_cache(user_id=user_id)


async def get_user_from_token(token: str | None) -> User | None:
    resolved = await resolve_session(token, rotate=False)
    return resolved.user if resolved else None


async def get_current_user(request: Request, response: Response) -> User:
    resolved = await resolve_session(request.cookies.get(COOKIE_NAME))
    if resolved is None:
        raise HTTPException(status_code=401, detail="No autenticado")
    request.state.auth_session_id = resolved.session_id
    request.state.auth_method = resolved.auth_method
    if resolved.rotated_token:
        set_session_cookie(
            response,
            request,
            resolved.rotated_token,
            persistent=resolved.persistent,
            absolute_expires_at=resolved.absolute_expires_at,
        )
    return resolved.user


def cookie_is_secure(request: Request) -> bool:
    if settings.cookie_secure is not None:
        return settings.cookie_secure
    forwarded_proto = request.headers.get("x-forwarded-proto", "")
    if forwarded_proto:
        return forwarded_proto.split(",")[0].strip().lower() == "https"
    return request.url.scheme == "https"


def set_session_cookie(response, request, token, *, persistent, absolute_expires_at) -> None:
    from datetime import datetime, timezone

    kwargs = {}
    if persistent:
        remaining = max(1, int((absolute_expires_at - datetime.now(timezone.utc)).total_seconds()))
        kwargs["max_age"] = remaining
    response.set_cookie(
        COOKIE_NAME,
        token,
        httponly=True,
        samesite="lax",
        secure=cookie_is_secure(request),
        path="/",
        **kwargs,
    )


def set_device_cookie(response, request, token, expires_at) -> None:
    from datetime import datetime, timezone

    remaining = max(1, int((expires_at - datetime.now(timezone.utc)).total_seconds()))
    response.set_cookie(
        DEVICE_COOKIE_NAME,
        token,
        httponly=True,
        samesite="lax",
        secure=cookie_is_secure(request),
        max_age=remaining,
        path="/",
    )


def clear_auth_cookies(response, request, *, include_device: bool = False) -> None:
    response.delete_cookie(
        COOKIE_NAME, path="/", httponly=True, samesite="lax", secure=cookie_is_secure(request)
    )
    if include_device:
        clear_device_cookie(response, request)


def clear_device_cookie(response, request) -> None:
    response.delete_cookie(
        DEVICE_COOKIE_NAME,
        path="/",
        httponly=True,
        samesite="lax",
        secure=cookie_is_secure(request),
    )


async def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Requiere permisos de administrador")
    return user


def _extract_bearer(authorization: str | None) -> str | None:
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer":
        return None
    return token.strip() or None


async def verify_webhook_token(
    authorization: str | None = Header(default=None),
    x_webhook_token: str | None = Header(default=None),
) -> None:
    from services.settings_service import get_effective

    expected = await get_effective("inbound_webhook_token")
    if not expected:
        # Falla cerrado. Antes esto hacía `return`, de modo que con el token
        # vacío —el valor de backend/.env.example— /api/webhooks/* y la subida
        # de media quedaban abiertos a Internet: cualquiera podía insertar
        # mensajes o mover la etapa de un lead, y eso dispara automatizaciones
        # y con ellas envíos reales de WhatsApp.
        #
        # 503 y no 401 a propósito: el que llama mandó lo correcto, es el
        # servidor el que está mal configurado. El arranque ya lo impide (ver
        # _require_inbound_webhook_token en main.py); esto cubre el caso de que
        # alguien borre el valor desde Configuración con la app en marcha.
        logger.error(
            "INBOUND_WEBHOOK_TOKEN no está configurado: se rechazan los webhooks "
            "entrantes. Definirlo en el entorno o en Configuración."
        )
        raise HTTPException(status_code=503, detail="Webhook entrante no configurado")
    provided = _extract_bearer(authorization) or x_webhook_token
    # compare_digest en vez de != para no filtrar el token por el tiempo de
    # comparación: estos endpoints son públicos y admiten reintentos ilimitados.
    if not provided or not secrets.compare_digest(provided, expected):
        raise HTTPException(status_code=401, detail="Token inválido")

import logging
import re
import secrets
from urllib.parse import urlsplit

import bcrypt
from fastapi import Depends, Header, Request, Response

from app.core.config import settings
from app.core.errors import Forbidden, Unauthorized, Unavailable
from app.db.models.auth import User
from app.db.privileges import set_request_db_role
from app.modules.auth.db_privileges import DB_ROLES
from app.modules.auth.permissions import can
from app.modules.auth.roles_service import permissions_for_role
from app.modules.auth.session_service import invalidate_session_cache, resolve_session

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


async def _with_permissions(user: User) -> User:
    # La fila vigente de la matriz de su rol, para ``can(user, ...)``. Se
    # asigna en cada petición: la sesión puede venir de la caché y la matriz
    # pudo cambiar desde que se resolvió.
    user.permissions = await permissions_for_role(user.role)
    # Desde acá, cada transacción de la petición corre con su rol de base.
    set_request_db_role(DB_ROLES.get(user.role))
    return user


async def get_user_from_token(token: str | None) -> User | None:
    resolved = await resolve_session(token, rotate=False)
    return await _with_permissions(resolved.user) if resolved else None


async def get_current_user(request: Request, response: Response) -> User:
    resolved = await resolve_session(request.cookies.get(COOKIE_NAME))
    if resolved is None:
        raise Unauthorized("No autenticado")
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
    return await _with_permissions(resolved.user)


def require_permission(*permissions: str):
    """Dependencia que deja pasar a quien tenga alguno de ``permissions``.

    Va después de renovar la cookie (la sesión sigue siendo válida aunque la
    ruta no sea para su rol). ``__permissions__`` es lo que mira
    ``tests/test_route_security.py`` para exigir un permiso en cada ruta.
    """
    if not permissions:
        raise ValueError("require_permission necesita al menos un permiso")

    async def dependency(user: User = Depends(get_current_user)) -> User:
        if not can(user, *permissions):
            raise Forbidden("Tu rol no tiene permiso para esto")
        return user

    dependency.__permissions__ = frozenset(permissions)
    dependency.__name__ = "require_" + "_or_".join(p.replace(".", "_") for p in permissions)
    return dependency


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


def websocket_origin_allowed(
    origin: str | None,
    host: str | None,
    allowed_origins: list[str],
    allowed_origin_regex: str | None = None,
) -> bool:
    if origin is None:
        return True
    if origin in allowed_origins:
        return True
    if allowed_origin_regex and re.fullmatch(allowed_origin_regex, origin):
        return True
    origin_host = urlsplit(origin).netloc.lower()
    return bool(host) and origin_host == host.lower()


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
    from app.modules.platform.public import platform_setting

    expected = await platform_setting("inbound_webhook_token")
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
        # alguien borre el valor desde plataforma con la app en marcha.
        logger.error(
            "INBOUND_WEBHOOK_TOKEN no está configurado: se rechazan los webhooks "
            "entrantes. Definirlo en el entorno o en el panel de plataforma."
        )
        raise Unavailable("Webhook entrante no configurado")
    provided = _extract_bearer(authorization) or x_webhook_token
    # compare_digest en vez de != para no filtrar el token por el tiempo de
    # comparación: estos endpoints son públicos y admiten reintentos ilimitados.
    if not provided or not secrets.compare_digest(provided, expected):
        # Solo el motivo, nunca el valor: sirve para saber qué credencial de
        # n8n revisar sin filtrar el token en los logs.
        logger.warning(
            "Webhook rechazado: %s",
            "no trae token (ni Authorization Bearer ni X-Webhook-Token)"
            if not provided
            else "el token no coincide con INBOUND_WEBHOOK_TOKEN",
        )
        raise Unauthorized("Token inválido")

"""Middleware ASGI que falla cerrado cuando un host tenant no está registrado."""

from __future__ import annotations

from collections.abc import Iterable

from starlette.datastructures import Headers
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from tenancy.context import reset_current_tenant, set_current_tenant
from tenancy.resolver import normalize_hostname, resolve_tenant_by_hostname


DEFAULT_EXEMPT_PATHS = frozenset(
    {
        "/health",
        "/health/ready",
        "/metrics",
        "/docs",
        "/docs/oauth2-redirect",
        "/redoc",
        "/openapi.json",
        "/api/media/upload",
        "/api/webhooks",
    }
)
DEFAULT_EXEMPT_PREFIXES = ("/api/webhooks/",)


class TenantResolutionMiddleware:
    """Resuelve tenant para HTTP y WebSocket antes de auth o lógica de negocio.

    Los webhooks quedan fuera porque llegan por un proveedor, no por el dominio
    del negocio; su endpoint debe resolver ``connection_id/phone_number_id`` en
    el plano de control. Los hosts de plataforma también son explícitos y nunca
    reciben por accidente el schema de un negocio.
    """

    def __init__(
        self,
        app: ASGIApp,
        *,
        enabled: bool,
        platform_hosts: Iterable[str] = (),
        exempt_paths: Iterable[str] = DEFAULT_EXEMPT_PATHS,
        exempt_prefixes: Iterable[str] = DEFAULT_EXEMPT_PREFIXES,
    ) -> None:
        self.app = app
        self.enabled = enabled
        self.platform_hosts = frozenset(
            normalize_hostname(host) for host in platform_hosts if host.strip()
        )
        self.exempt_paths = frozenset(exempt_paths)
        self.exempt_prefixes = tuple(exempt_prefixes)

    def _is_exempt(self, path: str) -> bool:
        return path in self.exempt_paths or any(
            path.startswith(prefix) for prefix in self.exempt_prefixes
        )

    async def _reject(self, scope: Scope, receive: Receive, send: Send, status: int) -> None:
        if scope["type"] == "websocket":
            await send({"type": "websocket.close", "code": 4404 if status == 404 else 4400})
            return
        response = JSONResponse(
            {"detail": "Tenant not found" if status == 404 else "Invalid host"},
            status_code=status,
        )
        await response(scope, receive, send)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if (
            not self.enabled
            or scope["type"] not in {"http", "websocket"}
            or self._is_exempt(scope.get("path", ""))
        ):
            await self.app(scope, receive, send)
            return

        try:
            hostname = normalize_hostname(Headers(scope=scope).get("host"))
        except ValueError:
            await self._reject(scope, receive, send, 400)
            return

        if hostname in self.platform_hosts:
            await self.app(scope, receive, send)
            return

        context = await resolve_tenant_by_hostname(hostname)
        if context is None:
            await self._reject(scope, receive, send, 404)
            return

        scope.setdefault("state", {})["tenant_context"] = context
        token = set_current_tenant(context)
        try:
            await self.app(scope, receive, send)
        finally:
            reset_current_tenant(token)

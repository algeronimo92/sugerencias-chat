from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
import pytest

import main
from app import bootstrap
from app.modules.auth.auth_service import get_current_user, require_admin, verify_webhook_token, websocket_origin_allowed
from app.modules.platform.platform_auth import get_current_platform_user

# El panel de plataforma tiene su propia identidad (public.platform_users), así
# que su guard es otro: sin incluirlo acá, sus rutas protegidas parecerían
# abiertas y la prueba obligaría a declararlas públicas, que es justo lo
# contrario de lo que son.
AUTH_GUARDS = {
    get_current_user,
    require_admin,
    verify_webhook_token,
    get_current_platform_user,
}

PUBLIC_ROUTES = {
    ("POST", "/api/auth/login"),
    ("POST", "/api/auth/logout"),
    ("GET", "/api/auth/pin/status"),
    ("POST", "/api/auth/pin/login"),
    # Invitaciones y recuperación se consumen antes de iniciar sesión. Los
    # tokens son opacos, expiran y se invalidan de forma atómica al usarlos;
    # forgot-password responde igual exista o no la cuenta.
    ("POST", "/api/auth/forgot-password"),
    ("GET", "/api/auth/action-token/{token}"),
    ("POST", "/api/auth/accept-invitation"),
    ("POST", "/api/auth/reset-password"),
    # El login del panel no puede exigir sesión; el middleware de tenancy ya lo
    # deja fuera del alcance de cualquier dominio de negocio.
    ("POST", "/api/platform/auth/login"),
    ("POST", "/api/platform/auth/logout"),
    # Marca del negocio: la pantalla de acceso y el manifest de la PWA la
    # necesitan sin sesión. Solo exponen nombre, color y logo, lo mismo que ya
    # muestra el login.
    ("GET", "/api/branding"),
    ("GET", "/api/branding/logo"),
    ("GET", "/api/branding/manifest.webmanifest"),
    # Webhook de Meta: Meta no manda sesión ni el token de las integraciones.
    # La suscripción se valida con el verify token y cada POST con la firma
    # HMAC del cuerpo crudo (ver app/integrations/meta_webhook/api.py).
    ("GET", "/api/webhooks/meta/whatsapp"),
    ("POST", "/api/webhooks/meta/whatsapp"),
    # Vuelta de Google tras "Conectar con Google": llega sin sesión a una URL
    # común. Solo actúa con un state firmado, vigente y cuyo nonce de un solo
    # uso coincide con el guardado por el negocio (ver google_calendar_api.py).
    ("GET", "/api/integrations/google/callback"),
    ("GET", "/health"),
    ("GET", "/health/ready"),
    ("GET", "/metrics"),
}


def _is_guarded(dependant) -> bool:
    return any(dep.call in AUTH_GUARDS or _is_guarded(dep) for dep in dependant.dependencies)


def test_every_api_route_requires_authentication_unless_explicitly_public():
    unguarded = {
        (method, route.path)
        for route in main.app.routes
        if isinstance(route, APIRoute) and not _is_guarded(route.dependant)
        for method in route.methods
    }

    assert unguarded - PUBLIC_ROUTES == set()


@pytest.mark.parametrize(("origin", "host", "allowed"), [
    ("https://dermicapro.cliniventas.com", "dermicapro.cliniventas.com", True),
    ("http://localhost:5174", "localhost:8000", True),
    (None, "dermicapro.cliniventas.com", True),
    ("https://otra.cliniventas.com", "dermicapro.cliniventas.com", False),
    ("https://evil.example", "localhost:8000", False),
])
def test_websocket_origin_must_be_same_host_or_configured(origin, host, allowed):
    assert websocket_origin_allowed(origin, host, ["http://localhost:5174"]) is allowed


def test_websocket_rejects_foreign_origin_before_reading_the_session(monkeypatch):
    async def fail_if_called(_token):
        pytest.fail("no debe resolver la sesión de un origen ajeno")

    monkeypatch.setattr(bootstrap, "get_user_from_token", fail_if_called)
    client = TestClient(main.app)

    with pytest.raises(WebSocketDisconnect) as closed:
        with client.websocket_connect("/ws/chats", headers={"origin": "https://evil.example"}):
            pass

    assert closed.value.code == 4403

"""El panel de plataforma vive fuera de los negocios, y tiene que quedarse ahí.

Dos garantías que no pueden aflojar nunca:

1. `/api/platform/*` responde en los hosts de plataforma y **no** en el dominio
   de un negocio. Si respondiera ahí, el CRM de un cliente sería una puerta al
   panel que administra a todos los demás.
2. La identidad del panel es propia (`platform_users`), no el rol `admin` de
   ningún schema tenant.
"""

from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import tenancy.middleware as middleware_module
from tenancy.context import TenantContext
from tenancy.middleware import TenantResolutionMiddleware


ORG = UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
TENANT = TenantContext(ORG, f"tenant_{ORG.hex}", "negocio.example.com")


def _app() -> FastAPI:
    app = FastAPI()

    @app.get("/api/platform/organizations")
    async def organizations():
        return {"items": []}

    @app.post("/api/platform/auth/login")
    async def login():
        return {"status": "ok"}

    @app.get("/private")
    async def private():
        return {"ok": True}

    app.add_middleware(
        TenantResolutionMiddleware,
        enabled=True,
        platform_hosts=("admin.example.com",),
    )
    return app


@pytest.fixture
def client(monkeypatch):
    async def resolve(hostname: str):
        return TENANT if hostname == TENANT.hostname else None

    monkeypatch.setattr(middleware_module, "resolve_tenant_by_hostname", resolve)
    return TestClient(_app())


def test_el_panel_responde_en_el_host_de_plataforma(client):
    respuesta = client.get(
        "/api/platform/organizations", headers={"host": "admin.example.com"}
    )
    assert respuesta.status_code == 200


def test_el_panel_no_existe_en_el_dominio_de_un_negocio(client):
    """La garantía central: aunque el host resuelva a un tenant válido."""
    respuesta = client.get(
        "/api/platform/organizations", headers={"host": TENANT.hostname}
    )
    assert respuesta.status_code == 404


def test_el_login_del_panel_tampoco_se_expone_en_un_negocio(client):
    assert (
        client.post("/api/platform/auth/login", headers={"host": TENANT.hostname}).status_code
        == 404
    )
    assert (
        client.post("/api/platform/auth/login", headers={"host": "admin.example.com"}).status_code
        == 200
    )


def test_un_host_desconocido_no_alcanza_el_panel(client):
    assert (
        client.get(
            "/api/platform/organizations", headers={"host": "otro.example.com"}
        ).status_code
        == 404
    )


def test_el_host_de_plataforma_sigue_sin_servir_rutas_del_crm(client):
    """El espejo de la primera garantía: el panel no da acceso a datos de negocio."""
    assert client.get("/private", headers={"host": "admin.example.com"}).status_code == 404
    assert client.get("/private", headers={"host": TENANT.hostname}).status_code == 200


def test_la_cookie_del_panel_es_distinta_a_la_del_crm():
    """Con el mismo nombre, un navegador mandaría la sesión del CRM al panel."""
    from services.auth_service import COOKIE_NAME
    from services.platform_auth import PLATFORM_COOKIE_NAME

    assert PLATFORM_COOKIE_NAME != COOKIE_NAME


def test_el_operador_no_es_un_usuario_de_negocio():
    """`platform_users` vive en public; `users` dentro de cada schema tenant."""
    from db.models import PlatformSession, PlatformUser, User

    assert PlatformUser.__table__.schema == "public"
    assert PlatformSession.__table__.schema == "public"
    assert User.__table__.schema is None

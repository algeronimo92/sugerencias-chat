"""La media de clientes no puede servirse sin sesión.

`/media/<archivo>` se incluía en main.py sin `Depends(get_current_user)`, a
diferencia del resto de routers, así que cualquiera con la URL podía ver
fotos, audios y documentos de pacientes. nginx además la marcaba
`Cache-Control: public, immutable` durante 7 días.

El 401 ocurre antes de tocar la base de datos: un token ausente o inválido lo
rechaza `get_user_from_token` sin consultar `users`, así que este test no
necesita PostgreSQL.
"""

import os

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(scope="module")
def client() -> TestClient:
    os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://u:p@localhost/test")
    os.environ.setdefault("SECRET_KEY", "test-secret-key")
    os.environ.setdefault("N8N_WEBHOOK_URL", "https://example.invalid/webhook")
    import main

    # Sin `with`: el context manager de TestClient dispara el lifespan, que
    # intenta conectarse a PostgreSQL y reintenta indefinidamente.
    return TestClient(main.app)


@pytest.mark.parametrize("method", ["GET", "HEAD"])
def test_media_without_session_is_rejected(client: TestClient, method: str) -> None:
    response = client.request(method, "/media/cualquier-archivo.jpg")
    assert response.status_code == 401


def test_media_with_invalid_token_is_rejected(client: TestClient) -> None:
    response = client.get(
        "/media/cualquier-archivo.jpg",
        headers={"Cookie": "access_token=no-es-un-jwt"},
    )
    assert response.status_code == 401


def test_health_stays_public(client: TestClient) -> None:
    """El healthcheck del contenedor no manda cookie: no debe pedir sesión."""
    assert client.get("/health").status_code == 200

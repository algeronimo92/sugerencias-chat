"""El token de webhook entrante no puede volver a ser opcional.

`verify_webhook_token` hacía `if not expected: return` cuando el token no
estaba configurado, que es el valor que traía `backend/.env.example`. Con esa
configuración, `/api/webhooks/*` y la subida de media quedaban abiertos a
Internet: cualquiera podía insertar mensajes o mover la etapa de un lead, y
eso dispara automatizaciones y con ellas envíos reales de WhatsApp.

Es un fail-open fácil de reintroducir "para no romper instalaciones", así que
la regla vive en un test: sin token configurado no se atiende a nadie.
"""

import asyncio

import pytest
from fastapi import HTTPException

from services import auth_service


@pytest.fixture
def configured_token(monkeypatch):
    """Sustituye la resolución del token, que normalmente consulta la base."""

    def _set(value: str) -> None:
        async def _get_effective(key: str) -> str:
            assert key == "inbound_webhook_token"
            return value

        monkeypatch.setattr("services.settings_service.get_effective", _get_effective)

    return _set


def _verify(authorization=None, x_webhook_token=None):
    return asyncio.run(auth_service.verify_webhook_token(authorization, x_webhook_token))


def test_sin_token_configurado_no_pasa_nadie(configured_token) -> None:
    configured_token("")
    with pytest.raises(HTTPException) as exc:
        _verify(authorization="Bearer lo-que-sea")
    # 503 y no 401: el que llama mandó algo válido, el servidor está mal
    # configurado. Distinguirlo importa para diagnosticarlo en los logs de n8n.
    assert exc.value.status_code == 503


def test_sin_token_configurado_tampoco_pasa_sin_cabecera(configured_token) -> None:
    configured_token("")
    with pytest.raises(HTTPException) as exc:
        _verify()
    assert exc.value.status_code == 503


def test_token_correcto_por_authorization(configured_token) -> None:
    configured_token("secreto")
    assert _verify(authorization="Bearer secreto") is None


def test_token_correcto_por_cabecera_propia(configured_token) -> None:
    configured_token("secreto")
    assert _verify(x_webhook_token="secreto") is None


@pytest.mark.parametrize(
    "authorization, x_webhook_token",
    [
        ("Bearer otro", None),
        ("Basic secreto", None),  # esquema equivocado
        ("secreto", None),  # sin esquema
        (None, "otro"),
        (None, None),
        (None, ""),
    ],
)
def test_token_incorrecto_o_ausente_es_401(configured_token, authorization, x_webhook_token) -> None:
    configured_token("secreto")
    with pytest.raises(HTTPException) as exc:
        _verify(authorization=authorization, x_webhook_token=x_webhook_token)
    assert exc.value.status_code == 401


def test_prefijo_no_alcanza(configured_token) -> None:
    """La comparación es del valor completo, no de un prefijo."""
    configured_token("secreto-largo")
    with pytest.raises(HTTPException) as exc:
        _verify(authorization="Bearer secreto")
    assert exc.value.status_code == 401

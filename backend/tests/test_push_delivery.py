"""Envío de avisos push: con qué vigencia y tiempo máximo salen, y que una
suscripción que falla no deja sin aviso a las demás.

Se reemplaza `webpush` por un doble: nada sale a un servicio de push real.
"""

import inspect
from types import SimpleNamespace

import pytest
import pywebpush
import requests

from app.core.config import settings
from app.modules.notifications import push_repository, push_service

_REAL_WEBPUSH_SIGNATURE = inspect.signature(pywebpush.webpush)


def _subscription(endpoint: str) -> SimpleNamespace:
    return SimpleNamespace(endpoint=endpoint, p256dh="p256dh", auth="auth")


class FakeWebPush:
    """Registra cada envío en vez de mandarlo."""

    def __init__(self) -> None:
        self.calls: list[dict] = []
        self.fail_for: dict[str, Exception] = {}

    def __call__(self, **kwargs) -> None:
        # Un doble que acepta cualquier argumento dejaría pasar un parámetro
        # que el paquete real no tiene; atarlo a la firma verdadera lo delata.
        _REAL_WEBPUSH_SIGNATURE.bind(**kwargs)
        self.calls.append(kwargs)
        failure = self.fail_for.get(kwargs["subscription_info"]["endpoint"])
        if failure:
            raise failure

    @property
    def endpoints(self) -> list[str]:
        return [call["subscription_info"]["endpoint"] for call in self.calls]


@pytest.fixture
def push(monkeypatch):
    """Push configurado, con un doble de `webpush` y suscripciones en memoria."""
    fake = FakeWebPush()
    subscriptions: list[SimpleNamespace] = []

    async def list_subscriptions(user_id: int) -> list[SimpleNamespace]:
        return list(subscriptions)

    monkeypatch.setattr(settings, "vapid_private_key", "clave-de-prueba")
    monkeypatch.setattr(push_service, "webpush", fake)
    monkeypatch.setattr(push_repository, "list_subscriptions", list_subscriptions)
    return SimpleNamespace(webpush=fake, subscriptions=subscriptions)


async def test_el_aviso_sale_con_vigencia_de_un_dia_y_tiempo_maximo(push):
    push.subscriptions.append(_subscription("https://push.example/a"))

    # Así la llaman hoy menciones, citas, reportes y automatizaciones.
    await push_service.send_push_to_user(7, "Título", "Cuerpo", "/chat/1", tag="nota-1")

    [call] = push.webpush.calls
    assert call["ttl"] == 24 * 60 * 60
    assert call["timeout"] == 5.0
    assert call["headers"] == {"Urgency": "normal"}


async def test_quien_llama_puede_pedir_otra_vigencia_y_urgencia(push):
    push.subscriptions.append(_subscription("https://push.example/a"))

    await push_service.send_push_to_user(7, "Título", "Cuerpo", "/chat/1", ttl_seconds=30, urgency="high")

    [call] = push.webpush.calls
    assert call["ttl"] == 30
    assert call["headers"] == {"Urgency": "high"}
    # El tiempo máximo protege al servidor, no depende del aviso.
    assert call["timeout"] == 5.0


async def test_un_tiempo_agotado_no_deja_sin_aviso_a_las_demas_suscripciones(push):
    push.subscriptions.extend([
        _subscription("https://push.example/colgado"),
        _subscription("https://push.example/sano"),
    ])
    push.webpush.fail_for["https://push.example/colgado"] = requests.exceptions.Timeout("read timed out")

    await push_service.send_push_to_user(7, "Título", "Cuerpo", "/chat/1")

    assert push.webpush.endpoints == ["https://push.example/colgado", "https://push.example/sano"]

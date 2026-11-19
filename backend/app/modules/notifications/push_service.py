"""Suscripciones push del navegador y el envío de avisos a cada una."""

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Literal

from pywebpush import WebPushException, webpush

from app.core.config import settings
from app.db.models.notifications import PushSubscription
from app.db.uow import unit_of_work
from app.modules.notifications import push_repository

logger = logging.getLogger(__name__)


async def save_subscription(user_id: int, endpoint: str, p256dh: str, auth: str, user_agent: str | None) -> None:
    async with unit_of_work():
        await push_repository.save_subscription(user_id, endpoint, p256dh, auth, user_agent)


async def delete_subscription(user_id: int, endpoint: str) -> None:
    async with unit_of_work():
        await push_repository.delete_subscription(user_id, endpoint)


async def _delete_dead_subscription(endpoint: str) -> None:
    """El navegador dio de baja la suscripción (404/410): no se vuelve a
    intentar con ella."""
    async with unit_of_work():
        await push_repository._delete_dead_subscription(endpoint)


# Vigencia que se le pide al servicio de push (cabecera TTL). pywebpush manda
# 0 si no se le dice nada, y 0 significa "entregar ahora o descartar": un
# celular sin señal en ese instante perdía el aviso para siempre. Una mención,
# una cita nueva o el fallo de una automatización siguen sirviendo horas
# después; pasado un día ya no hace falta despertar el teléfono, porque el
# aviso sigue en la campana al abrir la app.
PUSH_TTL_SECONDS = 24 * 60 * 60

# Tiempo máximo por envío. pywebpush le pasa `timeout=None` a requests, que
# entonces espera sin límite: un servicio de push que no responde retenía para
# siempre un hilo del executor por defecto, el mismo que usan los guardados de
# adjuntos y el worker de salida. requests lo aplica por separado a conectar y
# a cada lectura, así que es una cota por fase, no del envío completo.
PUSH_TIMEOUT_SECONDS = 5.0

# Urgencias de RFC 8030 §5.3. Con "normal" el aviso llega aunque el teléfono
# esté a batería y sin wifi, que es lo que se espera de un mensaje; "high"
# queda para lo que no tolera espera y las más bajas para lo que puede
# aguardar a que el equipo esté cargando. Es lo que el servicio asume sin
# cabecera; se manda igual para no depender de ese supuesto.
PushUrgency = Literal["very-low", "low", "normal", "high"]
PUSH_URGENCY: PushUrgency = "normal"


def _send_one(subscription: PushSubscription, payload: str, ttl_seconds: int, urgency: PushUrgency) -> None:
    webpush(
        subscription_info={
            "endpoint": subscription.endpoint,
            "keys": {"p256dh": subscription.p256dh, "auth": subscription.auth},
        },
        data=payload,
        vapid_private_key=settings.vapid_private_key,
        vapid_claims={"sub": settings.vapid_subject},
        ttl=ttl_seconds,
        timeout=PUSH_TIMEOUT_SECONDS,
        headers={"Urgency": urgency},
    )


async def send_push_to_user(
    user_id: int,
    title: str,
    body: str,
    url: str,
    tag: str | None = None,
    *,
    ttl_seconds: int = PUSH_TTL_SECONDS,
    urgency: PushUrgency = PUSH_URGENCY,
) -> None:
    """Envía una notificación push a todas las suscripciones activas del user.

    No es crítico: el evento ya quedó en `UserNotification` y se ve al abrir
    la app, así que un fallo puntual (o VAPID sin configurar) no debe
    interrumpir al llamador. Cada suscripción se intenta de forma
    independiente para que una muerta no frene el resto.

    `ttl_seconds` y `urgency` existen para los avisos que caducan rápido o no
    toleran espera; el resto usa los valores por defecto.
    """
    if not settings.vapid_private_key:
        logger.debug("Push no configurado (faltan claves VAPID); se omite el envío a user %s", user_id)
        return

    subscriptions = await push_repository.list_subscriptions(user_id)
    if not subscriptions:
        return

    payload = json.dumps({"title": title, "body": body, "url": url, "tag": tag})
    for subscription in subscriptions:
        try:
            await asyncio.to_thread(_send_one, subscription, payload, ttl_seconds, urgency)
        except WebPushException as exc:
            status_code = exc.response.status_code if exc.response is not None else None
            if status_code in (404, 410):
                await _delete_dead_subscription(subscription.endpoint)
            else:
                logger.exception("Fallo al enviar push a user %s (endpoint %s)", user_id, subscription.endpoint)
        except Exception:
            logger.exception("Fallo al enviar push a user %s (endpoint %s)", user_id, subscription.endpoint)

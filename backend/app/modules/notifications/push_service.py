from app.modules.notifications import push_repository
import asyncio
import json
import logging
from datetime import datetime, timezone

from pywebpush import WebPushException, webpush

from app.core.config import settings
from app.db.models.notifications import PushSubscription

logger = logging.getLogger(__name__)


async def save_subscription(user_id: int, endpoint: str, p256dh: str, auth: str, user_agent: str | None) -> None:
    return await push_repository.save_subscription(user_id, endpoint, p256dh, auth, user_agent)


async def delete_subscription(user_id: int, endpoint: str) -> None:
    return await push_repository.delete_subscription(user_id, endpoint)


async def _delete_dead_subscription(endpoint: str) -> None:
    return await push_repository._delete_dead_subscription(endpoint)


def _send_one(subscription: PushSubscription, payload: str) -> None:
    webpush(
        subscription_info={
            "endpoint": subscription.endpoint,
            "keys": {"p256dh": subscription.p256dh, "auth": subscription.auth},
        },
        data=payload,
        vapid_private_key=settings.vapid_private_key,
        vapid_claims={"sub": settings.vapid_subject},
    )


async def send_push_to_user(
    user_id: int,
    title: str,
    body: str,
    url: str,
    tag: str | None = None,
) -> None:
    """Envía una notificación push a todas las suscripciones activas del user.

    No es crítico: el evento ya quedó en `UserNotification` y se ve al abrir
    la app, así que un fallo puntual (o VAPID sin configurar) no debe
    interrumpir al llamador. Cada suscripción se intenta de forma
    independiente para que una muerta no frene el resto.
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
            await asyncio.to_thread(_send_one, subscription, payload)
        except WebPushException as exc:
            status_code = exc.response.status_code if exc.response is not None else None
            if status_code in (404, 410):
                await _delete_dead_subscription(subscription.endpoint)
            else:
                logger.exception("Fallo al enviar push a user %s (endpoint %s)", user_id, subscription.endpoint)
        except Exception:
            logger.exception("Fallo al enviar push a user %s (endpoint %s)", user_id, subscription.endpoint)

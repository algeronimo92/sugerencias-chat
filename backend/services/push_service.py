import asyncio
import json
import logging
from datetime import datetime, timezone

from pywebpush import WebPushException, webpush
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from config import settings
from db.models import PushSubscription
from db.session import get_sessionmaker

logger = logging.getLogger(__name__)


async def save_subscription(
    user_id: int,
    endpoint: str,
    p256dh: str,
    auth: str,
    user_agent: str | None,
) -> None:
    """Guarda o reasigna una suscripción push.

    El `endpoint` es único: si el mismo navegador ya estaba suscripto (a este
    u otro usuario, por ejemplo tras un cambio de sesión en el equipo), se
    actualiza en vez de duplicar la fila.
    """
    now = datetime.now(timezone.utc)
    async with get_sessionmaker()() as session:
        stmt = (
            pg_insert(PushSubscription)
            .values(
                user_id=user_id,
                endpoint=endpoint,
                p256dh=p256dh,
                auth=auth,
                user_agent=user_agent,
                created_at=now,
                last_seen_at=now,
            )
            .on_conflict_do_update(
                index_elements=[PushSubscription.endpoint],
                set_={
                    "user_id": user_id,
                    "p256dh": p256dh,
                    "auth": auth,
                    "user_agent": user_agent,
                    "last_seen_at": now,
                },
            )
        )
        await session.execute(stmt)
        await session.commit()


async def delete_subscription(user_id: int, endpoint: str) -> None:
    async with get_sessionmaker()() as session:
        await session.execute(
            delete(PushSubscription).where(
                PushSubscription.user_id == user_id,
                PushSubscription.endpoint == endpoint,
            )
        )
        await session.commit()


async def _delete_dead_subscription(endpoint: str) -> None:
    async with get_sessionmaker()() as session:
        await session.execute(delete(PushSubscription).where(PushSubscription.endpoint == endpoint))
        await session.commit()


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

    async with get_sessionmaker()() as session:
        subscriptions = (
            await session.execute(select(PushSubscription).where(PushSubscription.user_id == user_id))
        ).scalars().all()
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

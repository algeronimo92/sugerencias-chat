"""Atomic domain persistence. No HTTP, realtime, or service imports."""
from __future__ import annotations
from datetime import datetime, timezone
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from app.db.models.notifications import PushSubscription
from app.db.session import get_sessionmaker


async def list_subscriptions(user_id: int) -> list[PushSubscription]:
    async with get_sessionmaker()() as session:
        rows = await session.execute(select(PushSubscription).where(PushSubscription.user_id == user_id))
        return list(rows.scalars().all())

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

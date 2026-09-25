"""Límite de intentos de contraseña compartido entre workers, por tenant.

Se reserva el intento *antes* de comprobar la contraseña. Así, peticiones
paralelas no pueden atravesar el límite consultando todas el mismo contador.
No se confía en X-Forwarded-For enviado por el cliente: ``request.client`` ya
debe venir del proxy de confianza configurado en el servidor ASGI.
"""

import hashlib
import math
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select, update
from sqlalchemy.dialects.postgresql import insert

from db.models import AuthLoginThrottle
from db.session import get_sessionmaker

WINDOW = timedelta(minutes=15)
LOCK = timedelta(minutes=15)
ACCOUNT_LIMIT = 5
IP_LIMIT = 30


class LoginThrottledError(Exception):
    def __init__(self, retry_after_seconds: int):
        self.retry_after_seconds = retry_after_seconds


def _key(kind: str, value: str) -> str:
    return hashlib.sha256(f"{kind}:{value}".encode("utf-8")).hexdigest()


def _consume(row: AuthLoginThrottle, limit: int, now: datetime) -> bool:
    if now - row.window_started_at >= WINDOW or row.locked_until:
        row.attempts = 0
        row.window_started_at = now
        row.locked_until = None
    row.attempts += 1
    if row.attempts > limit:
        row.locked_until = now + LOCK
        return True
    return False


async def reserve_login_attempt(email: str, ip: str, *, scope: str = "crm") -> None:
    now = datetime.now(timezone.utc)
    limits = {_key(f"{scope}:account", email): ACCOUNT_LIMIT, _key(f"{scope}:ip", ip): IP_LIMIT}
    retry_after = 0
    async with get_sessionmaker()() as session:
        async with session.begin():
            rows = []
            # Orden fijo: dos logins concurrentes con la misma IP/cuenta no
            # adquieren locks en orden inverso.
            for key in sorted(limits):
                await session.execute(
                    insert(AuthLoginThrottle)
                    .values(key_hash=key, attempts=0, window_started_at=now)
                    .on_conflict_do_nothing(index_elements=[AuthLoginThrottle.key_hash])
                )
                row = await session.scalar(
                    select(AuthLoginThrottle)
                    .where(AuthLoginThrottle.key_hash == key)
                    .with_for_update()
                )
                rows.append((row, limits[key]))

            for row, _limit in rows:
                if row.locked_until and row.locked_until > now:
                    raise LoginThrottledError(math.ceil((row.locked_until - now).total_seconds()))

            for row, limit in rows:
                if _consume(row, limit, now):
                    retry_after = int(LOCK.total_seconds())
            if secrets.randbelow(100) == 0:
                await session.execute(
                    delete(AuthLoginThrottle)
                    .where(AuthLoginThrottle.window_started_at < now - WINDOW - LOCK)
                )
    if retry_after:
        raise LoginThrottledError(retry_after)


async def clear_account_attempts(email: str, *, scope: str = "crm") -> None:
    now = datetime.now(timezone.utc)
    async with get_sessionmaker()() as session:
        await session.execute(
            update(AuthLoginThrottle)
            .where(AuthLoginThrottle.key_hash == _key(f"{scope}:account", email))
            .values(attempts=0, window_started_at=now, locked_until=None)
        )
        await session.commit()


async def prune_old_attempts() -> int:
    """Para tarea de mantenimiento: borra ventanas ya inactivas."""
    cutoff = datetime.now(timezone.utc) - WINDOW - LOCK
    async with get_sessionmaker()() as session:
        result = await session.execute(
            delete(AuthLoginThrottle).where(AuthLoginThrottle.window_started_at < cutoff)
        )
        await session.commit()
        return result.rowcount or 0

import asyncpg
from config import settings

_pool: asyncpg.Pool | None = None


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        # Normaliza el scheme para asyncpg y deshabilita SSL
        url = settings.database_url.replace("postgres://", "postgresql://", 1)
        _pool = await asyncpg.create_pool(url, ssl=False)
    return _pool


async def close_pool():
    global _pool
    if _pool:
        await _pool.close()
        _pool = None


async def fetch_chats() -> list[dict]:
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT
                l.remote_jid                                    AS chat_id,
                l.telefono                                      AS phone,
                l.nombre                                        AS name,
                l.servicio_interes                              AS servicio_interes,
                l.vendedor                                      AS vendedor,
                l.origen                                        AS origen,
                l.notas                                         AS notas,
                m.content                                       AS last_message,
                to_char(l.ultimo_mensaje_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS timestamp
            FROM leads l
            LEFT JOIN LATERAL (
                SELECT content
                FROM wsp_messages
                WHERE chat_id = l.remote_jid
                ORDER BY sent_at DESC
                LIMIT 1
            ) m ON true
            ORDER BY l.ultimo_mensaje_at DESC NULLS LAST
            LIMIT 100
            """
        )
    return [dict(r) for r in rows]


async def fetch_messages(chat_id: str) -> list[dict]:
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT
                id,
                sender,
                content,
                to_char(sent_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS sent_at
            FROM wsp_messages
            WHERE chat_id = $1
            ORDER BY sent_at ASC
            LIMIT 500
            """,
            chat_id,
        )
    return [dict(r) for r in rows]

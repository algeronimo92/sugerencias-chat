from datetime import datetime, timezone

from sqlalchemy import exists, func, select, update

from db.models import Lead, WspMessage
from db.session import get_sessionmaker
from services.ai_context import make_context_revision


async def get_cached_suggestion(chat_id: str) -> dict | None:
    """Devuelve la última sugerencia de n8n guardada para este lead, siempre
    que siga vigente: tiene que existir Y no haber llegado ningún mensaje del
    cliente después de que se generó (un mensaje del propio vendedor no la
    invalida — la sugerencia sigue siendo válida para lo que dijo el cliente)."""
    has_newer_message = exists(
        select(WspMessage.id).where(
            WspMessage.chat_id == Lead.id,
            WspMessage.sender == "cliente",
            WspMessage.sent_at > Lead.cached_suggestion_at,
        )
    )
    stmt = select(
        Lead.cached_suggestion,
        Lead.cached_suggestion_at,
        has_newer_message.label("has_newer_message"),
    ).where(Lead.id == chat_id)
    async with get_sessionmaker()() as session:
        row = (await session.execute(stmt)).mappings().one_or_none()

    if (
        row is None
        or row["cached_suggestion"] is None
        or row["cached_suggestion_at"] is None
        or row["has_newer_message"]
    ):
        return None
    return row["cached_suggestion"]


async def get_suggestion_status(chat_id: str) -> dict | None:
    """Estado completo de la sugerencia guardada de un lead, sin descartar la
    desactualizada: a diferencia de get_cached_suggestion, acá se devuelve
    aunque el cliente haya escrito después (`stale=True`), porque la UI la
    sigue mostrando y solo avisa que quedó vieja — regenerar es siempre una
    decisión del vendedor, nunca un efecto automático de esta lectura.
    Devuelve None si el lead no existe."""
    has_newer_message = exists(
        select(WspMessage.id).where(
            WspMessage.chat_id == Lead.id,
            WspMessage.sender == "cliente",
            WspMessage.sent_at > Lead.cached_suggestion_at,
        )
    )
    stmt = select(
        Lead.cached_suggestion,
        Lead.cached_suggestion_at,
        has_newer_message.label("has_newer_message"),
    ).where(Lead.id == chat_id)
    async with get_sessionmaker()() as session:
        row = (await session.execute(stmt)).mappings().one_or_none()

    if row is None:
        return None
    if row["cached_suggestion"] is None or row["cached_suggestion_at"] is None:
        return {"suggestion": None, "generated_at": None, "stale": False}
    return {
        "suggestion": row["cached_suggestion"],
        "generated_at": row["cached_suggestion_at"],
        "stale": bool(row["has_newer_message"]),
    }


async def cache_suggestion(chat_id: str, suggestion: dict) -> bool:
    stmt = (
        update(Lead)
        .where(Lead.id == chat_id)
        .values(cached_suggestion=suggestion, cached_suggestion_at=datetime.now(timezone.utc))
    )
    async with get_sessionmaker()() as session:
        result = await session.execute(stmt)
        await session.commit()
    return result.rowcount > 0


async def cache_suggestion_if_current(
    chat_id: str,
    suggestion: dict,
    expected_context_revision: str,
) -> str:
    """Guarda solo si el contexto que vio el modelo sigue vigente.

    Devuelve ``cached``, ``stale`` o ``missing``. El lock del lead coordina la
    comprobaciÃ³n con ediciones del CRM; el id mÃ¡ximo detecta mensajes nuevos.
    """

    async with get_sessionmaker()() as session:
        lead = (
            await session.execute(
                select(Lead.id, Lead.updated_at)
                .where(Lead.id == chat_id)
                .with_for_update()
            )
        ).mappings().first()
        if lead is None:
            return "missing"
        latest_message_id = await session.scalar(
            select(func.max(WspMessage.id)).where(WspMessage.chat_id == chat_id)
        )
        current_revision = make_context_revision(lead["updated_at"], latest_message_id)
        if current_revision != expected_context_revision:
            return "stale"
        await session.execute(
            update(Lead)
            .where(Lead.id == chat_id)
            .values(
                cached_suggestion=suggestion,
                cached_suggestion_at=datetime.now(timezone.utc),
            )
        )
        await session.commit()
    return "cached"

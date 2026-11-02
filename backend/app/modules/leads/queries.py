"""Lado de lectura del lead: consultas para pantallas e integraciones.

No pasan por el dominio ni por la unidad de trabajo: leen y devuelven lo que
la pantalla necesita. Un archivo ``*queries.py`` nunca escribe (ver
``tests/test_layering.py``).
"""

from __future__ import annotations

from sqlalchemy import select, text

from app.core.time_format import iso_utc_micros
from app.db.models.auth import User
from app.db.models.leads import LeadActivity
from app.core.serialization import json_safe_row as _json_safe_row
from app.db.uow import session_scope


async def list_lead_activity(chat_id: str, limit: int = 50) -> list[dict]:
    stmt = (
        select(
            LeadActivity.id,
            LeadActivity.event_type,
            LeadActivity.actor_type,
            User.name.label("actor_name"),
            LeadActivity.old_value,
            LeadActivity.new_value,
            LeadActivity.metadata_,
            LeadActivity.created_at,
        )
        .outerjoin(User, User.id == LeadActivity.actor_user_id)
        .where(LeadActivity.lead_id == chat_id)
        .order_by(LeadActivity.created_at.desc(), LeadActivity.id.desc())
        .limit(limit)
    )
    async with session_scope() as session:
        rows = (await session.execute(stmt)).mappings().all()
    return [
        {
            "id": row["id"],
            "event_type": row["event_type"],
            "actor_type": row["actor_type"],
            "actor_name": row["actor_name"],
            "old_value": row["old_value"],
            "new_value": row["new_value"],
            "metadata": row["metadata_"],
            "created_at": iso_utc_micros(row["created_at"]),
        }
        for row in rows
    ]


async def fetch_lead_raw(chat_id: str) -> dict | None:
    """Fila cruda de ``leads`` (todas las columnas de la tabla, incluidas las
    que no están mapeadas en el ORM). La usan los endpoints que reemplazan a
    los nodos Postgres ``get lead1``/``try to get lead`` de n8n."""
    async with session_scope() as session:
        row = (
            await session.execute(text("SELECT * FROM leads WHERE id = :id"), {"id": chat_id})
        ).mappings().first()
    return _json_safe_row(dict(row)) if row is not None else None


async def fetch_messages_raw(chat_id: str, limit: int = 500) -> list[dict]:
    """Filas crudas de ``wsp_messages`` de un chat, más recientes primero.
    Reemplaza al nodo Postgres ``get messages`` de n8n."""
    async with session_scope() as session:
        rows = (
            await session.execute(
                text("SELECT * FROM wsp_messages WHERE chat_id = :chat_id ORDER BY id DESC LIMIT :limit"),
                {"chat_id": chat_id, "limit": limit},
            )
        ).mappings().all()
    return [_json_safe_row(dict(row)) for row in rows]

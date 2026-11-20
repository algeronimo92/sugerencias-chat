"""Lado de lectura del lead: consultas para pantallas e integraciones.

No pasan por el dominio ni por la unidad de trabajo: leen y devuelven lo que
la pantalla necesita. Un archivo ``*queries.py`` nunca escribe (ver
``tests/test_layering.py``).
"""

from __future__ import annotations

from sqlalchemy import func, select, text

from app.core.time_format import iso_utc_micros
from app.db.models.auth import User
from app.db.models.leads import Lead, LeadActivity, WhatsAppIdentity
from app.core.serialization import json_safe_row as _json_safe_row
from app.db.uow import session_scope


async def lead_ids_for_contacts(phones: list[str], user_ids: list[str]) -> dict[str, str]:
    """Identificador (número E.164 o BSUID) -> lead que lo usa, para enlazar
    contactos de la agenda con sus leads. Los que no tienen lead no aparecen."""
    identifiers = {value for value in (*phones, *user_ids) if value}
    if not identifiers:
        return {}
    by_identity = select(WhatsAppIdentity.identifier, WhatsAppIdentity.lead_id).where(
        WhatsAppIdentity.identifier.in_(identifiers)
    )
    by_phone = select(Lead.telefono, Lead.id).where(Lead.telefono.in_({p for p in phones if p}))
    async with session_scope() as session:
        found: dict[str, str] = {}
        # El teléfono del lead primero: la identidad de WhatsApp manda si difieren.
        for identifier, lead_id in (await session.execute(by_phone)).all():
            found.setdefault(identifier, str(lead_id))
        for identifier, lead_id in (await session.execute(by_identity)).all():
            found[identifier] = str(lead_id)
    return found


def lead_ids_owned_by(owner_id: int):
    """Subconsulta para filtrar datos asociados sin copiar la regla de dueño."""
    return select(Lead.id).where(Lead.vendedor_id == owner_id)


async def fetch_lead_sellers(lead_ids: list[str]) -> dict[str, int | None]:
    """Vendedor asignado de cada lead pedido. Los que no existen no aparecen."""
    wanted = {lead_id for lead_id in lead_ids if lead_id}
    if not wanted:
        return {}
    stmt = select(Lead.id, Lead.vendedor_id).where(Lead.id.in_(wanted))
    async with session_scope() as session:
        return {str(lead_id): seller_id for lead_id, seller_id in (await session.execute(stmt)).all()}


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
    if row is None:
        return None
    return _json_safe_row(dict(row))


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


def _lead_label(nombre: str | None, telefono: str | None) -> str:
    return (nombre or "").strip() or (telefono or "").strip() or "Sin nombre"


async def service_usage(service_id: int, name: str, limit: int) -> dict:
    """Leads que tienen el servicio como interés: cuántos y los más recientes
    (id del lead, nombre o teléfono), para ir a cada chat. El interés se compara como lo sigue un renombre: sin
    mayúsculas ni espacios de los bordes."""
    interested = func.lower(func.btrim(Lead.servicio_interes)) == name.strip().lower()
    async with session_scope() as session:
        leads = await session.scalar(select(func.count()).select_from(Lead).where(interested)) or 0
        lead_rows = (await session.execute(
            select(Lead.id, Lead.nombre, Lead.telefono).where(interested)
            .order_by(Lead.ultimo_mensaje_at.desc().nulls_last()).limit(limit)
        )).all() if leads else []
    return {
        "leads": leads,
        "lead_items": [(str(row.id), _lead_label(row.nombre, row.telefono)) for row in lead_rows],
    }

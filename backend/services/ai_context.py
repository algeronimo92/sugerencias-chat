"""Contexto versionado que el backend entrega a los subworkflows de IA.

n8n recibe una proyecciÃ³n allowlist del CRM y una revisiÃ³n opaca. Nunca recibe
un nombre de schema ni decide a quÃ© tenant conectarse: la sesiÃ³n activa ya fue
resuelta por la capa HTTP antes de llegar a estos helpers.
"""

from __future__ import annotations

from datetime import datetime
from hashlib import sha256

from sqlalchemy import func, select

from db.models import Lead, WspMessage
from db.session import get_sessionmaker
from services.store.common import _fmt_ts, _json_safe_row


def make_context_revision(updated_at: datetime | None, latest_message_id: int | None) -> str:
    """Firma opaca del lead y del Ãºltimo mensaje visible para la IA."""

    lead_part = updated_at.isoformat() if updated_at is not None else ""
    message_part = str(latest_message_id or 0)
    digest = sha256(f"v1\x00{lead_part}\x00{message_part}".encode()).hexdigest()
    return f"v1:{digest}"


async def fetch_context_revision(chat_id: str) -> str | None:
    """RevisiÃ³n actual, o ``None`` si el lead no existe."""

    async with get_sessionmaker()() as session:
        updated_at = await session.scalar(select(Lead.updated_at).where(Lead.id == chat_id))
        if updated_at is None:
            # Los leads antiguos pueden no tener updated_at; se comprueba la
            # existencia aparte para no confundirlos con un id inexistente.
            exists = await session.scalar(select(Lead.id).where(Lead.id == chat_id))
            if exists is None:
                return None
        latest_message_id = await session.scalar(
            select(func.max(WspMessage.id)).where(WspMessage.chat_id == chat_id)
        )
    return make_context_revision(updated_at, latest_message_id)


async def fetch_analysis_context(chat_id: str, limit: int = 500) -> dict | None:
    """Snapshot allowlist para el agente analista.

    Los mensajes conservan el orden descendente del SQL legado. Si existe un
    resumen IA de un adjunto se concatena al texto como hacÃ­a ``get messages1``.
    """

    lead_columns = (
        Lead.id,
        Lead.nombre,
        Lead.telefono,
        Lead.servicio_interes,
        Lead.notas,
        Lead.estado,
        Lead.razon_perdido,
        Lead.fecha_recontacto,
        Lead.tipo_objecion,
        Lead.proxima_cita,
        Lead.con_especialista,
        Lead.ultimo_emisor,
        Lead.updated_at,
    )
    message_columns = (
        WspMessage.id,
        WspMessage.chat_id,
        WspMessage.sender,
        WspMessage.sent_at,
        WspMessage.status,
        WspMessage.media_url,
        WspMessage.message_type,
        WspMessage.content,
        WspMessage.analysis,
        WspMessage.wa_message_id,
    )

    async with get_sessionmaker()() as session:
        lead_row = (
            await session.execute(select(*lead_columns).where(Lead.id == chat_id))
        ).mappings().first()
        if lead_row is None:
            return None
        message_rows = (
            await session.execute(
                select(*message_columns)
                .where(WspMessage.chat_id == chat_id)
                .order_by(WspMessage.id.desc())
                .limit(limit)
            )
        ).mappings().all()

    messages: list[dict] = []
    for row in message_rows:
        item = _json_safe_row(dict(row))
        analysis = item.pop("analysis", None)
        summary = analysis.get("summary") if isinstance(analysis, dict) else None
        parts = [str(item.get("content") or "").strip()]
        if summary:
            parts.append(f"[Analisis IA] {str(summary).strip()}")
        item["content"] = "\n".join(part for part in parts if part) or None
        messages.append(item)

    latest = message_rows[0] if message_rows else None
    revision = make_context_revision(
        lead_row["updated_at"], int(latest["id"]) if latest is not None else None
    )
    lead = _json_safe_row(dict(lead_row))
    lead.pop("updated_at", None)
    return {
        "context_revision": revision,
        "lead": lead,
        "messages": messages,
        "message_cursor": (
            {
                "id": str(latest["id"]),
                "wa_message_id": latest["wa_message_id"],
                "sent_at": _fmt_ts(latest["sent_at"]),
            }
            if latest is not None
            else None
        ),
    }

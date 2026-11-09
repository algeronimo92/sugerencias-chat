"""Versioned context delivered by the backend to AI subworkflows.

n8n receives an allowlisted CRM projection and an opaque revision. It never
receives a schema name or chooses the tenant connection.
"""

from __future__ import annotations

from datetime import datetime
from hashlib import sha256

from sqlalchemy import func, select

from app.db.models.leads import Lead
from app.db.models.conversations import WspMessage
from app.integrations.meta.text import message_text
from app.core.serialization import json_safe_row as _json_safe_row
from app.core.time_format import iso_utc_micros as _fmt_ts
from app.db.uow import session_scope
from app.modules.leads.public import lead_purchases_for_ai

# Raíces de Meta que no son mensajes del cliente ni del negocio.
NON_CONVERSATIONAL_TYPES = frozenset({"system"})


def make_context_revision(updated_at: datetime | None, latest_message_id: int | None) -> str:
    """Build an opaque signature from the lead and latest visible message."""

    lead_part = updated_at.isoformat() if updated_at is not None else ""
    message_part = str(latest_message_id or 0)
    digest = sha256(f"v1\x00{lead_part}\x00{message_part}".encode()).hexdigest()
    return f"v1:{digest}"


async def fetch_context_revision(chat_id: str) -> str | None:
    """Return the current revision, or ``None`` when the lead is missing."""

    async with session_scope() as session:
        updated_at = await session.scalar(select(Lead.updated_at).where(Lead.id == chat_id))
        if updated_at is None:
            # Old leads may not have updated_at. Check existence separately.
            exists = await session.scalar(select(Lead.id).where(Lead.id == chat_id))
            if exists is None:
                return None
        latest_message_id = await session.scalar(
            select(func.max(WspMessage.id)).where(WspMessage.chat_id == chat_id)
        )
    return make_context_revision(updated_at, latest_message_id)


def _conversational_text(row) -> str:
    """Lo que dijo el mensaje, también cuando no es texto. Una foto, un audio
    o un botón tocado llegaban como ``content: null`` y el modelo veía un
    turno vacío del cliente; ahora lee "[imagen] <pie>", "Tocó el botón: …".
    Un texto plano sigue siendo su texto."""
    if row["message_type"] in (None, "text"):
        return str(row["content"] or "").strip()
    return message_text(row["message_type"], row["message_subtype"], row["content"], row["provider_payload"]).strip()


def ad_description(referral: dict) -> str:
    """Desde qué anuncio escribió el cliente (``messages[].referral`` de
    Meta): el titular y el texto del anuncio dicen qué promoción vio, que
    rara vez repite en su primer mensaje."""
    parts = [str(referral.get(key) or "").strip() for key in ("headline", "body")]
    described = " — ".join(part for part in parts if part)
    kind = "publicación" if referral.get("source_type") == "post" else "anuncio"
    return f"Escribió desde un {kind}: {described}" if described else f"Escribió desde un {kind}"


async def fetch_analysis_context(chat_id: str, limit: int = 500) -> dict | None:
    """Return the allowlisted analyst snapshot in legacy descending order."""

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
        # El prompt del copiloto los lee desde el principio, pero hasta
        # 2026-11-09 no se seleccionaban: llegaban siempre vacíos y el
        # modelo nunca supo de un no-show ni cuánto llevaba callado el chat.
        Lead.contador_noshow,
        Lead.ultimo_mensaje_at,
        Lead.updated_at,
    )
    message_columns = (
        WspMessage.id,
        WspMessage.chat_id,
        WspMessage.sender,
        WspMessage.direction,
        WspMessage.sent_at,
        WspMessage.outbox_status,
        WspMessage.meta_status,
        WspMessage.media_url,
        WspMessage.message_type,
        WspMessage.message_subtype,
        WspMessage.provider_payload,
        WspMessage.content,
        WspMessage.analysis,
        WspMessage.wa_message_id,
    )

    async with session_scope() as session:
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
    # Los avisos de Meta (cambio de número, de identidad) no son algo que
    # haya dicho el cliente ni el negocio: van aparte para que el analista no
    # los lea como parte de la conversación.
    system_events: list[dict] = []
    for row in message_rows:
        item = _json_safe_row(dict(row))
        if item.get("message_type") in NON_CONVERSATIONAL_TYPES:
            system_events.append({
                "id": item["id"],
                "sent_at": item["sent_at"],
                "message_subtype": item.get("message_subtype"),
                "text": message_text(
                    row["message_type"], row["message_subtype"], row["content"], row["provider_payload"],
                ),
            })
            continue
        analysis = item.pop("analysis", None)
        summary = analysis.get("summary") if isinstance(analysis, dict) else None
        parts = [_conversational_text(row)]
        if summary:
            parts.append(f"[Analisis IA] {str(summary).strip()}")
        item["content"] = "\n".join(part for part in parts if part) or None
        referral = (row["provider_payload"] or {}).get("referral") if isinstance(row["provider_payload"], dict) else None
        if isinstance(referral, dict):
            item["anuncio"] = ad_description(referral)
        messages.append(item)

    latest = message_rows[0] if message_rows else None
    revision = make_context_revision(
        lead_row["updated_at"], int(latest["id"]) if latest is not None else None
    )
    lead = _json_safe_row(dict(lead_row))
    # Lo que ya compró: el analista no debe volver a cotizarlo.
    lead["compras"] = await lead_purchases_for_ai(chat_id)
    lead.pop("updated_at", None)
    return {
        "context_revision": revision,
        "lead": lead,
        "messages": messages,
        "system_events": system_events,
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

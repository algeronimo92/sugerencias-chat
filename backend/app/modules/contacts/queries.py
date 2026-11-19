"""Lado de lectura de la agenda: la lista, el detalle, las importaciones con
sus conteos para elegir qué importar, y el estado de la sincronización."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import Select, and_, case, exists, func, or_, select

from app.core.time_format import iso_utc
from app.db.models.contacts import (
    Contact, ContactImportBatch, ContactImportRow, ContactSettings, WhatsAppAppSync,
)
from app.db.uow import session_scope

# Periodos que se ofrecen para elegir "solo quienes conversaron en los
# últimos N días". Coinciden con las fases en que Meta manda el historial.
RECENT_WINDOWS = (1, 7, 30, 90, 180)
SYNC_WINDOW = timedelta(hours=24)


def _contact(row) -> dict:
    return {
        "id": str(row["id"]),
        "nombre": row["nombre"],
        "telefono": row["telefono"],
        "wa_user_id": row["wa_user_id"],
        "username": row["username"],
        "email": row["email"],
        "notas": row["notas"],
        "etiquetas": list(row["etiquetas"] or []),
        "origen": row["origen"],
        "consentimiento_marketing": row["consentimiento_marketing"],
        "consentimiento_at": iso_utc(row["consentimiento_at"]),
        "lead_id": str(row["lead_id"]) if row["lead_id"] else None,
        "eliminado_en_app_at": iso_utc(row["eliminado_en_app_at"]),
        "ultima_interaccion_at": iso_utc(row["ultima_interaccion_at"]),
        "created_at": iso_utc(row["created_at"]),
        "updated_at": iso_utc(row["updated_at"]),
    }


def _contact_query() -> Select:
    return select(
        Contact.id, Contact.nombre, Contact.telefono, Contact.wa_user_id, Contact.username, Contact.email,
        Contact.notas, Contact.etiquetas, Contact.origen, Contact.consentimiento_marketing,
        Contact.consentimiento_at, Contact.lead_id, Contact.eliminado_en_app_at,
        Contact.ultima_interaccion_at, Contact.created_at, Contact.updated_at,
    )


def _escaped(term: str) -> str:
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


async def list_contacts(
    *,
    search: str | None = None,
    origen: str | None = None,
    tag: str | None = None,
    has_lead: bool | None = None,
    removed_in_app: bool | None = None,
    consent: bool | None = None,
    offset: int = 0,
    limit: int = 50,
) -> dict:
    conditions = []
    if search and search.strip():
        term = search.strip()
        pattern = f"%{_escaped(term)}%"
        digits = "".join(ch for ch in term if ch.isdigit())
        options = [Contact.nombre.ilike(pattern, escape="\\"), Contact.email.ilike(pattern, escape="\\"),
                   Contact.username.ilike(pattern, escape="\\")]
        if len(digits) >= 3:
            options.append(Contact.telefono.like(f"%{digits}%"))
        conditions.append(or_(*options))
    if origen:
        conditions.append(Contact.origen == origen)
    if tag:
        conditions.append(Contact.etiquetas.any(tag))
    if has_lead is not None:
        conditions.append(Contact.lead_id.is_not(None) if has_lead else Contact.lead_id.is_(None))
    if removed_in_app is not None:
        conditions.append(
            Contact.eliminado_en_app_at.is_not(None) if removed_in_app else Contact.eliminado_en_app_at.is_(None)
        )
    if consent is not None:
        conditions.append(Contact.consentimiento_marketing.is_(consent))
    stmt = (
        _contact_query()
        .where(*conditions)
        .order_by(func.lower(func.coalesce(Contact.nombre, "~")), Contact.created_at.desc(), Contact.id)
        .offset(offset)
        .limit(limit)
    )
    async with session_scope() as session:
        rows = (await session.execute(stmt)).mappings().all()
        total = await session.scalar(select(func.count()).select_from(Contact).where(*conditions))
    return {"items": [_contact(row) for row in rows], "total": total or 0}


async def get_contact(contact_id: str) -> dict | None:
    async with session_scope() as session:
        row = (await session.execute(_contact_query().where(Contact.id == contact_id))).mappings().first()
    return _contact(row) if row else None


async def list_tags() -> list[str]:
    tag = func.unnest(Contact.etiquetas).column_valued("tag")
    async with session_scope() as session:
        rows = (await session.execute(select(tag).distinct().order_by(tag))).scalars().all()
    return [row for row in rows if row]


# --- Importaciones ---------------------------------------------------------

def _exists_in_contacts():
    """La fila corresponde a alguien que ya está en la agenda."""
    return exists().where(or_(
        and_(ContactImportRow.telefono.is_not(None), Contact.telefono == ContactImportRow.telefono),
        and_(ContactImportRow.wa_user_id.is_not(None), Contact.wa_user_id == ContactImportRow.wa_user_id),
    ))


async def batch_summary(batch_id: str) -> dict | None:
    now = datetime.now(timezone.utc)
    pending = ContactImportRow.outcome.is_(None)
    valid = and_(pending, ContactImportRow.error.is_(None))

    def count(condition):
        return func.count().filter(condition)

    stmt = select(
        count(valid).label("pending"),
        count(and_(pending, ContactImportRow.error.is_not(None))).label("invalid"),
        count(and_(valid, _exists_in_contacts())).label("existing"),
        count(and_(valid, ContactImportRow.ultima_interaccion_at.is_not(None))).label("with_interaction"),
        count(ContactImportRow.outcome == "created").label("created"),
        count(ContactImportRow.outcome == "updated").label("updated"),
        count(ContactImportRow.outcome == "skipped").label("skipped"),
        count(ContactImportRow.outcome == "discarded").label("discarded"),
        *[
            count(and_(valid, ContactImportRow.ultima_interaccion_at >= now - timedelta(days=days))).label(f"d{days}")
            for days in RECENT_WINDOWS
        ],
    ).where(ContactImportRow.batch_id == batch_id)
    async with session_scope() as session:
        batch = (await session.execute(
            select(
                ContactImportBatch.id, ContactImportBatch.source, ContactImportBatch.status,
                ContactImportBatch.file_name, ContactImportBatch.created_at, ContactImportBatch.updated_at,
                ContactImportBatch.closed_at,
            ).where(ContactImportBatch.id == batch_id)
        )).mappings().first()
        if batch is None:
            return None
        counts = (await session.execute(stmt)).mappings().one()
    return {
        "id": str(batch["id"]),
        "source": batch["source"],
        "status": batch["status"],
        "file_name": batch["file_name"],
        "created_at": iso_utc(batch["created_at"]),
        "updated_at": iso_utc(batch["updated_at"]),
        "closed_at": iso_utc(batch["closed_at"]),
        "counts": {
            key: counts[key] for key in (
                "pending", "invalid", "existing", "with_interaction", "created", "updated", "skipped", "discarded",
            )
        },
        "recent": [{"days": days, "count": counts[f"d{days}"]} for days in RECENT_WINDOWS],
    }


async def list_batches(limit: int = 20) -> list[dict]:
    async with session_scope() as session:
        ids = (await session.execute(
            select(ContactImportBatch.id)
            .order_by(case((ContactImportBatch.status == "open", 0), else_=1), ContactImportBatch.created_at.desc())
            .limit(limit)
        )).scalars().all()
    return [summary for batch_id in ids if (summary := await batch_summary(str(batch_id)))]


async def batch_rows(
    batch_id: str,
    *,
    status: str = "pending",
    search: str | None = None,
    offset: int = 0,
    limit: int = 50,
) -> dict:
    """``status``: ``pending`` (se pueden elegir), ``invalid`` o ``processed``."""
    conditions = [ContactImportRow.batch_id == batch_id]
    if status == "invalid":
        conditions += [ContactImportRow.outcome.is_(None), ContactImportRow.error.is_not(None)]
    elif status == "processed":
        conditions.append(ContactImportRow.outcome.is_not(None))
    else:
        conditions += [ContactImportRow.outcome.is_(None), ContactImportRow.error.is_(None)]
    if search and search.strip():
        pattern = f"%{_escaped(search.strip())}%"
        conditions.append(or_(
            ContactImportRow.nombre.ilike(pattern, escape="\\"),
            ContactImportRow.telefono.like(pattern, escape="\\"),
            ContactImportRow.email.ilike(pattern, escape="\\"),
        ))
    existing = _exists_in_contacts().label("exists")
    stmt = (
        select(
            ContactImportRow.id, ContactImportRow.row_number, ContactImportRow.nombre, ContactImportRow.telefono,
            ContactImportRow.wa_user_id, ContactImportRow.email, ContactImportRow.etiquetas,
            ContactImportRow.consentimiento, ContactImportRow.ultima_interaccion_at, ContactImportRow.error,
            ContactImportRow.outcome, existing,
        )
        .where(*conditions)
        .order_by(
            ContactImportRow.ultima_interaccion_at.desc().nulls_last(),
            ContactImportRow.row_number.asc().nulls_last(),
            ContactImportRow.id,
        )
        .offset(offset)
        .limit(limit)
    )
    async with session_scope() as session:
        rows = (await session.execute(stmt)).mappings().all()
        total = await session.scalar(select(func.count()).select_from(ContactImportRow).where(*conditions))
    return {
        "items": [
            {
                "id": row["id"], "row_number": row["row_number"], "nombre": row["nombre"],
                "telefono": row["telefono"], "wa_user_id": row["wa_user_id"], "email": row["email"],
                "etiquetas": list(row["etiquetas"] or []), "consentimiento": row["consentimiento"],
                "ultima_interaccion_at": iso_utc(row["ultima_interaccion_at"]), "error": row["error"],
                "outcome": row["outcome"], "exists": bool(row["exists"]),
            }
            for row in rows
        ],
        "total": total or 0,
    }


async def whatsapp_sync_status() -> dict:
    now = datetime.now(timezone.utc)
    async with session_scope() as session:
        syncs = (await session.execute(
            select(
                WhatsAppAppSync.phone_number_id, WhatsAppAppSync.sync_type, WhatsAppAppSync.status,
                WhatsAppAppSync.error, WhatsAppAppSync.progress, WhatsAppAppSync.window_started_at,
                WhatsAppAppSync.requested_at, WhatsAppAppSync.updated_at,
            ).order_by(WhatsAppAppSync.window_started_at.desc())
        )).mappings().all()
        auto_import = await session.scalar(
            select(ContactSettings.auto_import_whatsapp).where(ContactSettings.id == 1)
        )
        open_batch = await session.scalar(
            select(ContactImportBatch.id).where(
                ContactImportBatch.source == "whatsapp_app", ContactImportBatch.status == "open",
            )
        )
    return {
        "auto_import": bool(auto_import),
        "open_batch_id": str(open_batch) if open_batch else None,
        "syncs": [
            {
                "phone_number_id": row["phone_number_id"],
                "sync_type": row["sync_type"],
                "status": row["status"],
                "error": row["error"],
                "progress": row["progress"],
                "requested_at": iso_utc(row["requested_at"]),
                "updated_at": iso_utc(row["updated_at"]),
                "window_ends_at": iso_utc(row["window_started_at"] + SYNC_WINDOW),
                "can_retry": row["status"] == "failed" and now < row["window_started_at"] + SYNC_WINDOW,
            }
            for row in syncs
        ],
    }

"""Escrituras de la agenda, sus importaciones y la sincronización con el
celular. Corre dentro de la unidad de trabajo del comando que la llama."""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import bindparam, delete, or_, select, update
from sqlalchemy.dialects.postgresql import insert

from app.db.models.contacts import (
    Contact, ContactImportBatch, ContactImportRow, ContactSettings, WhatsAppAppSync, WhatsAppHistoryChunk,
)
from app.db.uow import session_scope
from app.modules.contacts.normalization import ContactDraft
from app.modules.contacts.types import ImportSource, RowOutcome

_CHUNK = 1000


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _chunks(items: Sequence[Any], size: int = _CHUNK) -> Iterable[Sequence[Any]]:
    for start in range(0, len(items), size):
        yield items[start:start + size]


def _identity_filter(model, phones: Iterable[str | None], user_ids: Iterable[str | None]):
    phones = sorted({p for p in phones if p})
    user_ids = sorted({u for u in user_ids if u})
    clauses = []
    if phones:
        clauses.append(model.telefono.in_(phones))
    if user_ids:
        clauses.append(model.wa_user_id.in_(user_ids))
    return or_(*clauses) if clauses else None


# --- Contactos -------------------------------------------------------------

_CONTACT_COLUMNS = (
    Contact.id, Contact.nombre, Contact.telefono, Contact.wa_user_id, Contact.username, Contact.email,
    Contact.notas, Contact.etiquetas, Contact.consentimiento_marketing, Contact.lead_id,
    Contact.editado_en_crm_at, Contact.eliminado_en_app_at, Contact.meta_changed_at,
    Contact.ultima_interaccion_at,
)


async def contacts_by_identity(phones: Iterable[str | None], user_ids: Iterable[str | None]) -> list[dict]:
    condition = _identity_filter(Contact, phones, user_ids)
    if condition is None:
        return []
    async with session_scope() as session:
        rows = (await session.execute(select(*_CONTACT_COLUMNS).where(condition))).mappings().all()
    return [dict(row) for row in rows]


async def contacts_by_ids(contact_ids: list[str]) -> list[dict]:
    async with session_scope() as session:
        rows = (await session.execute(select(*_CONTACT_COLUMNS).where(Contact.id.in_(contact_ids)))).mappings().all()
    return [dict(row) for row in rows]


async def contact_row(contact_id: str, *, lock: bool = False) -> dict | None:
    stmt = select(*_CONTACT_COLUMNS).where(Contact.id == contact_id)
    if lock:
        stmt = stmt.with_for_update()
    async with session_scope() as session:
        row = (await session.execute(stmt)).mappings().first()
    return dict(row) if row else None


async def insert_contacts(values: list[dict]) -> list[dict]:
    """Inserta en lotes. Un contacto que ya existe (mismo teléfono o BSUID,
    escrito por otra petición en paralelo) se salta en vez de fallar: no
    vuelve en el resultado."""
    created: list[dict] = []
    now = _now()
    async with session_scope() as session:
        for chunk in _chunks(values):
            stmt = (
                insert(Contact)
                .values([{**value, "created_at": now, "updated_at": now} for value in chunk])
                .on_conflict_do_nothing()
                .returning(Contact.id, Contact.telefono, Contact.wa_user_id)
            )
            created.extend(dict(row) for row in (await session.execute(stmt)).mappings().all())
    return created


async def update_contact(contact_id: str, values: dict) -> bool:
    if not values:
        return True
    async with session_scope() as session:
        result = await session.execute(
            update(Contact).where(Contact.id == contact_id).values(**values, updated_at=_now())
        )
    return bool(result.rowcount)


async def update_contacts(values_by_id: dict[str, dict]) -> None:
    async with session_scope() as session:
        for contact_id, values in values_by_id.items():
            if values:
                await session.execute(
                    update(Contact).where(Contact.id == contact_id).values(**values, updated_at=_now())
                )


async def delete_contacts(contact_ids: list[str]) -> int:
    async with session_scope() as session:
        result = await session.execute(delete(Contact).where(Contact.id.in_(contact_ids)))
    return result.rowcount or 0


async def contacts_needing_lead(contact_ids: list[str] | None = None) -> list[dict]:
    stmt = select(Contact.id, Contact.telefono, Contact.wa_user_id).where(Contact.lead_id.is_(None))
    if contact_ids is not None:
        stmt = stmt.where(Contact.id.in_(contact_ids))
    async with session_scope() as session:
        return [dict(row) for row in (await session.execute(stmt)).mappings().all()]


async def link_leads(pairs: list[tuple[str, str]]) -> None:
    if not pairs:
        return
    # La tabla (SQL Core) y no el modelo: con una lista de parámetros el ORM lo
    # tomaría como Bulk UPDATE by Primary Key, que no admite este WHERE.
    table = Contact.__table__
    stmt = (
        update(table)
        .where(table.c.id == bindparam("contact_id"), table.c.lead_id.is_(None))
        .values(lead_id=bindparam("new_lead_id"), updated_at=_now())
    )
    async with session_scope() as session:
        await session.execute(
            stmt, [{"contact_id": contact_id, "new_lead_id": lead_id} for contact_id, lead_id in pairs],
        )


# --- Importaciones ---------------------------------------------------------

async def create_batch(source: str, *, file_name: str | None, user_id: int | None) -> str:
    async with session_scope() as session:
        return str(await session.scalar(
            insert(ContactImportBatch)
            .values(source=source, file_name=file_name, created_by_user_id=user_id)
            .returning(ContactImportBatch.id)
        ))


async def open_whatsapp_batch(*, create: bool) -> str | None:
    """La importación abierta donde esperan los contactos del celular."""
    find = select(ContactImportBatch.id).where(
        ContactImportBatch.source == ImportSource.WHATSAPP_APP, ContactImportBatch.status == "open",
    )
    async with session_scope() as session:
        batch_id = await session.scalar(find)
        if batch_id is None and create:
            await session.execute(
                insert(ContactImportBatch)
                .values(source=ImportSource.WHATSAPP_APP)
                .on_conflict_do_nothing()
            )
            batch_id = await session.scalar(find)
    return str(batch_id) if batch_id else None


async def batch_row(batch_id: str, *, lock: bool = False) -> dict | None:
    stmt = select(ContactImportBatch.id, ContactImportBatch.source, ContactImportBatch.status).where(
        ContactImportBatch.id == batch_id,
    )
    if lock:
        stmt = stmt.with_for_update()
    async with session_scope() as session:
        row = (await session.execute(stmt)).mappings().first()
    return dict(row) if row else None


def _row_values(batch_id: str, draft: ContactDraft, row_number: int | None, key: str) -> dict:
    return {
        "batch_id": batch_id, "row_number": row_number, "dedupe_key": key, "nombre": draft.nombre,
        "telefono": draft.telefono, "wa_user_id": draft.wa_user_id, "username": draft.username,
        "email": draft.email, "notas": draft.notas, "etiquetas": draft.etiquetas,
        "consentimiento": draft.consentimiento, "ultima_interaccion_at": draft.ultima_interaccion_at,
        "error": draft.error,
    }


async def insert_csv_rows(batch_id: str, drafts: list[tuple[int, ContactDraft]]) -> int:
    """Filas del archivo. Un número repetido en el mismo archivo queda una
    sola vez (la primera). Devuelve cuántas se guardaron."""
    values = [
        _row_values(batch_id, draft, row_number, draft.dedupe_key or f"row:{row_number}")
        for row_number, draft in drafts
    ]
    stored = 0
    async with session_scope() as session:
        for chunk in _chunks(values):
            result = await session.execute(
                insert(ContactImportRow).values(list(chunk)).on_conflict_do_nothing()
                .returning(ContactImportRow.id)
            )
            stored += len(result.all())
        await session.execute(
            update(ContactImportBatch).where(ContactImportBatch.id == batch_id).values(updated_at=_now())
        )
    return stored


async def pending_rows_by_identity(batch_id: str, phones: Iterable[str | None], user_ids: Iterable[str | None]) -> list[dict]:
    condition = _identity_filter(ContactImportRow, phones, user_ids)
    if condition is None:
        return []
    async with session_scope() as session:
        rows = (await session.execute(
            select(
                ContactImportRow.id, ContactImportRow.telefono, ContactImportRow.wa_user_id,
                ContactImportRow.meta_changed_at, ContactImportRow.ultima_interaccion_at,
            ).where(ContactImportRow.batch_id == batch_id, ContactImportRow.outcome.is_(None), condition)
        )).mappings().all()
    return [dict(row) for row in rows]


async def add_app_row(batch_id: str, draft: ContactDraft, changed_at: datetime | None) -> int | None:
    values = _row_values(batch_id, draft, None, draft.dedupe_key or "")
    values["meta_changed_at"] = changed_at
    async with session_scope() as session:
        return await session.scalar(
            insert(ContactImportRow).values(**values).on_conflict_do_nothing().returning(ContactImportRow.id)
        )


async def update_app_row(row_id: int, values: dict) -> None:
    async with session_scope() as session:
        await session.execute(update(ContactImportRow).where(ContactImportRow.id == row_id).values(**values))


async def delete_app_rows(row_ids: list[int]) -> None:
    if row_ids:
        async with session_scope() as session:
            await session.execute(delete(ContactImportRow).where(ContactImportRow.id.in_(row_ids)))


async def touch_batch(batch_id: str) -> None:
    async with session_scope() as session:
        await session.execute(
            update(ContactImportBatch).where(ContactImportBatch.id == batch_id).values(updated_at=_now())
        )


async def selected_rows(
    batch_id: str, *, since: datetime | None, row_ids: list[int] | None, limit: int | None,
) -> list[dict]:
    """Filas pendientes y válidas que entran en la selección: las de
    conversación más reciente primero, después en el orden del archivo."""
    conditions = []
    if since is not None:
        conditions.append(ContactImportRow.ultima_interaccion_at >= since)
    if row_ids is not None:
        conditions.append(ContactImportRow.id.in_(row_ids))
    stmt = (
        select(
            ContactImportRow.id, ContactImportRow.nombre, ContactImportRow.telefono, ContactImportRow.wa_user_id,
            ContactImportRow.username, ContactImportRow.email, ContactImportRow.notas, ContactImportRow.etiquetas,
            ContactImportRow.consentimiento, ContactImportRow.ultima_interaccion_at,
            ContactImportRow.meta_changed_at,
        )
        .where(
            ContactImportRow.batch_id == batch_id,
            ContactImportRow.outcome.is_(None),
            ContactImportRow.error.is_(None),
            *conditions,
        )
        .order_by(
            ContactImportRow.ultima_interaccion_at.desc().nulls_last(),
            ContactImportRow.row_number.asc().nulls_last(),
            ContactImportRow.id,
        )
        .with_for_update()
    )
    if limit is not None:
        stmt = stmt.limit(limit)
    async with session_scope() as session:
        return [dict(row) for row in (await session.execute(stmt)).mappings().all()]


async def mark_rows(outcomes: list[dict]) -> None:
    """``outcomes``: ``{"row_id", "outcome", "contact_id"}`` por fila."""
    if not outcomes:
        return
    table = ContactImportRow.__table__
    stmt = (
        update(table)
        .where(table.c.id == bindparam("row_id"))
        .values(outcome=bindparam("new_outcome"), contact_id=bindparam("new_contact_id"), processed_at=_now())
    )
    async with session_scope() as session:
        for chunk in _chunks(outcomes):
            await session.execute(stmt, [
                {"row_id": item["row_id"], "new_outcome": str(item["outcome"]), "new_contact_id": item["contact_id"]}
                for item in chunk
            ])


async def close_batch(batch_id: str, *, discard_pending: bool) -> None:
    now = _now()
    async with session_scope() as session:
        if discard_pending:
            await session.execute(
                update(ContactImportRow)
                .where(ContactImportRow.batch_id == batch_id, ContactImportRow.outcome.is_(None))
                .values(outcome=RowOutcome.DISCARDED, processed_at=now)
            )
        await session.execute(
            update(ContactImportBatch)
            .where(ContactImportBatch.id == batch_id)
            .values(status="closed", closed_at=now, updated_at=now)
        )


async def has_pending_rows(batch_id: str) -> bool:
    async with session_scope() as session:
        return bool(await session.scalar(
            select(ContactImportRow.id)
            .where(ContactImportRow.batch_id == batch_id, ContactImportRow.outcome.is_(None))
            .limit(1)
        ))


# --- Sincronización con el celular ----------------------------------------

async def auto_import_whatsapp() -> bool:
    async with session_scope() as session:
        return bool(await session.scalar(select(ContactSettings.auto_import_whatsapp).where(ContactSettings.id == 1)))


async def set_auto_import_whatsapp(enabled: bool) -> None:
    async with session_scope() as session:
        await session.execute(
            insert(ContactSettings)
            .values(id=1, auto_import_whatsapp=enabled, updated_at=_now())
            .on_conflict_do_update(
                index_elements=[ContactSettings.id],
                set_={"auto_import_whatsapp": enabled, "updated_at": _now()},
            )
        )


async def save_sync(phone_number_id: str, sync_type: str, values: dict) -> None:
    """Crea o actualiza el pedido de ese número y tipo. El plazo de Meta corre
    desde la conexión: ``window_started_at`` solo cambia si se pasa (una
    reconexión abre una ventana nueva)."""
    now = _now()
    window = values.get("window_started_at") or now
    insert_values = {key: value for key, value in values.items() if key != "window_started_at"}
    async with session_scope() as session:
        await session.execute(
            insert(WhatsAppAppSync)
            .values(
                phone_number_id=phone_number_id, sync_type=sync_type,
                window_started_at=window, updated_at=now, **insert_values,
            )
            .on_conflict_do_update(
                index_elements=[WhatsAppAppSync.phone_number_id, WhatsAppAppSync.sync_type],
                set_={**values, "updated_at": now},
            )
        )


async def sync_row(phone_number_id: str, sync_type: str) -> dict | None:
    async with session_scope() as session:
        row = (await session.execute(
            select(WhatsAppAppSync.status, WhatsAppAppSync.progress, WhatsAppAppSync.window_started_at).where(
                WhatsAppAppSync.phone_number_id == phone_number_id, WhatsAppAppSync.sync_type == sync_type,
            )
        )).mappings().first()
    return dict(row) if row else None


async def store_history_chunk(phone_number_id: str, phase: int | None, chunk_order: int | None,
                              progress: int | None, payload: dict) -> None:
    async with session_scope() as session:
        await session.execute(insert(WhatsAppHistoryChunk).values(
            phone_number_id=phone_number_id, phase=phase, chunk_order=chunk_order,
            progress=progress, payload=payload,
        ))


async def bump_last_interaction(values: list[tuple[str, datetime]]) -> None:
    """Contacto -> fecha del último mensaje; nunca la mueve hacia atrás."""
    if not values:
        return
    table = Contact.__table__
    stmt = (
        update(table)
        .where(
            table.c.id == bindparam("contact_id"),
            or_(table.c.ultima_interaccion_at.is_(None), table.c.ultima_interaccion_at < bindparam("stamp")),
        )
        .values(ultima_interaccion_at=bindparam("stamp"))
    )
    async with session_scope() as session:
        await session.execute(stmt, [{"contact_id": contact_id, "stamp": stamp} for contact_id, stamp in values])

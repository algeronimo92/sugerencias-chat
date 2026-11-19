"""Importaciones: un CSV o lo que mandó la app del celular esperan como filas
hasta que alguien elige qué parte pasa a la agenda (todo, solo quienes
conversaron en los últimos N días, un máximo de N o una por una). Se puede
confirmar en varias tandas; descartar cierra la importación."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from app.db.uow import collect, unit_of_work
from app.modules.contacts import repository
from app.modules.contacts.csv_reader import (
    FIELDS, CsvFormatError, mapped_values, read_csv, suggest_mapping,
)
from app.modules.contacts.errors import ImportClosed, ImportNotFound, InvalidImport
from app.modules.contacts.events import ContactImportsChanged, ContactsChanged
from app.modules.contacts.normalization import draft_from_csv_row, merge_tags, parse_tags
from app.modules.contacts.queries import batch_summary
from app.modules.contacts.service import link_leads
from app.modules.contacts.types import DuplicatePolicy, ImportSource, RowOutcome, SelectionMode
from app.modules.platform.public import effective_country_code

PREVIEW_ROWS = 5
# Campos que "completar vacíos" puede llenar en un contacto existente.
_FILLABLE = ("nombre", "username", "email", "notas")


@dataclass(frozen=True)
class Selection:
    mode: SelectionMode = SelectionMode.ALL
    days: int | None = None
    limit: int | None = None
    row_ids: list[int] = field(default_factory=list)
    duplicates: DuplicatePolicy = DuplicatePolicy.SKIP
    tags: list[str] = field(default_factory=list)
    # Cierra la importación al terminar y descarta lo que no se eligió.
    close: bool = False


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _table(content: bytes):
    try:
        return read_csv(content)
    except CsvFormatError as exc:
        raise InvalidImport(str(exc)) from exc


def preview_csv(content: bytes) -> dict:
    table = _table(content)
    return {
        "headers": table.headers,
        "sample": [row[: len(table.headers)] for row in table.rows[:PREVIEW_ROWS]],
        "total_rows": len(table.rows),
        "mapping": suggest_mapping(table.headers),
    }


def _validated_mapping(mapping: dict[str, int | None], headers: list[str]) -> dict[str, int | None]:
    clean = {name: mapping.get(name) for name in FIELDS}
    if clean["telefono"] is None:
        raise InvalidImport("Elige la columna del teléfono")
    used = [index for index in clean.values() if index is not None]
    if any(index < 0 or index >= len(headers) for index in used):
        raise InvalidImport("El mapeo apunta a una columna que no existe")
    if len(used) != len(set(used)):
        raise InvalidImport("Una columna no puede llenar dos campos")
    return clean


async def create_csv_import(
    content: bytes, *, file_name: str | None, mapping: dict[str, int | None], user_id: int,
) -> dict:
    table = _table(content)
    mapping = _validated_mapping(mapping, table.headers)
    country = await effective_country_code()
    # +2: la fila 1 del archivo son los encabezados.
    drafts = [
        (index + 2, draft_from_csv_row(mapped_values(row, mapping), country))
        for index, row in enumerate(table.rows)
    ]
    async with unit_of_work():
        batch_id = await repository.create_batch(
            ImportSource.CSV, file_name=(file_name or "")[:200] or None, user_id=user_id,
        )
        await repository.insert_csv_rows(batch_id, drafts)
        collect(ContactImportsChanged())
    return await batch_summary(batch_id)


def _index(contacts: list[dict]) -> dict[str, dict]:
    index: dict[str, dict] = {}
    for contact in contacts:
        for key in (contact.get("telefono"), contact.get("wa_user_id")):
            if key:
                index[key] = contact
    return index


def _fill_empty(contact: dict, row: dict, tags: list[str], index: dict[str, dict]) -> dict:
    """Lo que el contacto existente tiene vacío y la fila trae. Nunca pisa un
    dato, y el nombre editado en el CRM no se toca."""
    values = {
        name: row[name] for name in _FILLABLE
        if not contact.get(name) and row.get(name)
        and not (name == "nombre" and contact.get("editado_en_crm_at"))
    }
    # Un número o BSUID que ya usa otro contacto no se copia: chocaría.
    for name in ("telefono", "wa_user_id"):
        if not contact.get(name) and row.get(name) and row[name] not in index:
            values[name] = row[name]
    merged = merge_tags(contact.get("etiquetas"), [*(row.get("etiquetas") or []), *tags])
    if merged != list(contact.get("etiquetas") or []):
        values["etiquetas"] = merged
    if row.get("consentimiento") and not contact.get("consentimiento_marketing"):
        values.update(consentimiento_marketing=True, consentimiento_at=_now())
    stamp = row.get("ultima_interaccion_at")
    if stamp and (not contact.get("ultima_interaccion_at") or stamp > contact["ultima_interaccion_at"]):
        values["ultima_interaccion_at"] = stamp
    return values


def _new_contact(row: dict, source: str, tags: list[str]) -> dict:
    consent = bool(row.get("consentimiento"))
    return {
        "nombre": row.get("nombre"),
        "telefono": row.get("telefono"),
        "wa_user_id": row.get("wa_user_id"),
        "username": row.get("username"),
        "email": row.get("email"),
        "notas": row.get("notas"),
        "etiquetas": merge_tags(row.get("etiquetas"), tags),
        "origen": source,
        "consentimiento_marketing": consent,
        "consentimiento_at": _now() if consent else None,
        "meta_changed_at": row.get("meta_changed_at"),
        "ultima_interaccion_at": row.get("ultima_interaccion_at"),
    }


async def confirm_import(batch_id: str, selection: Selection) -> dict:
    if selection.mode == SelectionMode.RECENT and not selection.days:
        raise InvalidImport("Elige de cuántos días")
    if selection.mode == SelectionMode.MANUAL and not selection.row_ids:
        raise InvalidImport("Marca al menos un contacto")
    tags = parse_tags(selection.tags)
    result = {"created": 0, "updated": 0, "skipped": 0}
    async with unit_of_work():
        batch = await repository.batch_row(batch_id, lock=True)
        if batch is None:
            raise ImportNotFound()
        if batch["status"] != "open":
            raise ImportClosed()
        rows = await repository.selected_rows(
            batch_id,
            since=_now() - timedelta(days=selection.days) if selection.mode == SelectionMode.RECENT else None,
            row_ids=selection.row_ids if selection.mode == SelectionMode.MANUAL else None,
            limit=selection.limit,
        )
        index = _index(await repository.contacts_by_identity(
            [row["telefono"] for row in rows], [row["wa_user_id"] for row in rows],
        ))
        outcomes: list[dict] = []
        updates: dict[str, dict] = {}
        new_rows: list[dict] = []
        for row in rows:
            contact = index.get(row["telefono"] or "") or index.get(row["wa_user_id"] or "")
            if contact is None:
                new_rows.append(row)
                continue
            values = (
                _fill_empty(contact, row, tags, index)
                if selection.duplicates == DuplicatePolicy.FILL_EMPTY else {}
            )
            contact_id = str(contact["id"])
            if values:
                updates.setdefault(contact_id, {}).update(values)
                contact.update(values)
            outcomes.append({
                "row_id": row["id"], "contact_id": contact_id,
                "outcome": RowOutcome.UPDATED if values else RowOutcome.SKIPPED,
            })
        created = await repository.insert_contacts([_new_contact(row, batch["source"], tags) for row in new_rows])
        created_index = _index(created)
        for row in new_rows:
            contact = created_index.get(row["telefono"] or "") or created_index.get(row["wa_user_id"] or "")
            outcomes.append({
                "row_id": row["id"], "contact_id": str(contact["id"]) if contact else None,
                "outcome": RowOutcome.CREATED if contact else RowOutcome.SKIPPED,
            })
            if contact:
                # Dos filas de la misma persona: solo la primera la crea.
                created_index.pop(contact.get("telefono") or "", None)
                created_index.pop(contact.get("wa_user_id") or "", None)
        await repository.update_contacts(updates)
        await link_leads(created)
        await repository.mark_rows(outcomes)
        if selection.close or not await repository.has_pending_rows(batch_id):
            await repository.close_batch(batch_id, discard_pending=True)
        for item in outcomes:
            result[str(item["outcome"])] += 1
        collect(ContactsChanged(), ContactImportsChanged())
    return result


async def discard_import(batch_id: str) -> None:
    async with unit_of_work():
        batch = await repository.batch_row(batch_id, lock=True)
        if batch is None:
            raise ImportNotFound()
        if batch["status"] != "open":
            raise ImportClosed()
        await repository.close_batch(batch_id, discard_pending=True)
        collect(ContactImportsChanged())

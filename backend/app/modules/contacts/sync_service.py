"""Sincronización con la app WhatsApp Business del celular (coexistencia).

Los cambios de la agenda del celular actualizan a quien ya está en el CRM. A
quien todavía no está lo deja esperando en la importación abierta para que
alguien elija, salvo que el negocio haya activado la importación automática.
El historial solo se usa para saber con quién hubo conversación y cuándo:
eso es lo que permite elegir "los que hablaron en los últimos N días"."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.db.uow import collect, unit_of_work
from app.modules.contacts import repository
from app.modules.contacts.events import ContactImportsChanged, ContactsChanged
from app.modules.contacts.normalization import ContactDraft
from app.modules.contacts.service import link_leads
from app.modules.contacts.types import ContactOrigin, SyncStatus, SyncType
from app.modules.contacts.whatsapp_app import AppContactChange, HistoryThread, contact_changes, history_chunks

SYNC_WINDOW = timedelta(hours=24)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _find(index: dict[str, dict], telefono: str | None, wa_user_id: str | None) -> dict | None:
    return index.get(wa_user_id or "") or index.get(telefono or "")


def _remember(index: dict[str, dict], item: dict) -> None:
    for key in (item.get("telefono"), item.get("wa_user_id")):
        if key:
            index[key] = item


def _is_older(stamp: datetime | None, known: datetime | None) -> bool:
    return bool(stamp and known and stamp < known)


def _contact_update(contact: dict, change: AppContactChange, index: dict[str, dict]) -> dict:
    stamp = change.changed_at or _now()
    if change.action == "remove":
        return {"eliminado_en_app_at": stamp, "meta_changed_at": stamp}
    values: dict = {"eliminado_en_app_at": None, "meta_changed_at": stamp}
    if change.nombre and not contact.get("editado_en_crm_at"):
        values["nombre"] = change.nombre
    if change.username:
        values["username"] = change.username
    for name in ("telefono", "wa_user_id"):
        incoming = getattr(change, name)
        if incoming and not contact.get(name) and incoming not in index:
            values[name] = incoming
    return values


async def _stage(batch_id: str, draft: ContactDraft, changed_at: datetime | None,
                 rows: dict[str, dict]) -> None:
    """Deja a la persona esperando en la importación abierta, o completa la
    fila que ya tenía (por ejemplo, la creó el historial sin nombre)."""
    row = _find(rows, draft.telefono, draft.wa_user_id)
    if row is None:
        row_id = await repository.add_app_row(batch_id, draft, changed_at)
        _remember(rows, {
            "id": row_id, "telefono": draft.telefono, "wa_user_id": draft.wa_user_id,
            "meta_changed_at": changed_at, "ultima_interaccion_at": draft.ultima_interaccion_at,
        })
        return
    if row.get("id") is None or _is_older(changed_at, row.get("meta_changed_at")):
        return
    values: dict = {}
    if draft.nombre:
        values["nombre"] = draft.nombre
    if draft.username:
        values["username"] = draft.username
    if changed_at:
        values["meta_changed_at"] = changed_at
    for name in ("telefono", "wa_user_id"):
        if getattr(draft, name) and not row.get(name):
            values[name] = getattr(draft, name)
    stamp = draft.ultima_interaccion_at
    if stamp and (not row.get("ultima_interaccion_at") or stamp > row["ultima_interaccion_at"]):
        values["ultima_interaccion_at"] = stamp
    if values:
        await repository.update_app_row(row["id"], values)
        row.update(values)


async def apply_app_contacts(phone_number_id: str, value: dict) -> None:
    """Webhook ``smb_app_state_sync``. Idempotente: el inbox puede reintentar."""
    changes = contact_changes(value)
    if not changes:
        return
    async with unit_of_work():
        auto_import = await repository.auto_import_whatsapp()
        contacts = _index(await repository.contacts_by_identity(
            [change.telefono for change in changes], [change.wa_user_id for change in changes],
        ))
        batch_id = await repository.open_whatsapp_batch(create=False)
        rows = _index(await repository.pending_rows_by_identity(
            batch_id, [c.telefono for c in changes], [c.wa_user_id for c in changes],
        )) if batch_id else {}
        changed_contacts = staged = False
        for change in changes:
            contact = _find(contacts, change.telefono, change.wa_user_id)
            if contact is not None:
                if _is_older(change.changed_at, contact.get("meta_changed_at")):
                    continue
                values = _contact_update(contact, change, contacts)
                await repository.update_contact(str(contact["id"]), values)
                contact.update(values)
                _remember(contacts, contact)
                changed_contacts = True
                continue
            if change.action == "remove":
                row = _find(rows, change.telefono, change.wa_user_id)
                if row and row.get("id") and not _is_older(change.changed_at, row.get("meta_changed_at")):
                    await repository.delete_app_rows([row["id"]])
                    rows = {key: item for key, item in rows.items() if item is not row}
                    staged = True
                continue
            if auto_import:
                created = await repository.insert_contacts([{
                    "nombre": change.nombre, "telefono": change.telefono, "wa_user_id": change.wa_user_id,
                    "username": change.username, "origen": ContactOrigin.WHATSAPP_APP,
                    "meta_changed_at": change.changed_at,
                }])
                await link_leads(created)
                for item in created:
                    _remember(contacts, {**item, "meta_changed_at": change.changed_at})
                changed_contacts = True
                continue
            batch_id = batch_id or await repository.open_whatsapp_batch(create=True)
            draft = ContactDraft(
                nombre=change.nombre, telefono=change.telefono, wa_user_id=change.wa_user_id,
                username=change.username,
            )
            await _stage(batch_id, draft, change.changed_at, rows)
            staged = True
        if staged and batch_id:
            await repository.touch_batch(batch_id)
        await repository.save_sync(phone_number_id, SyncType.CONTACTS, {"status": SyncStatus.RECEIVING})
        if changed_contacts:
            collect(ContactsChanged())
        collect(ContactImportsChanged())


def _index(items: list[dict]) -> dict[str, dict]:
    index: dict[str, dict] = {}
    for item in items:
        _remember(index, item)
    return index


async def _apply_threads(threads: list[HistoryThread]) -> bool:
    contacts = _index(await repository.contacts_by_identity(
        [t.telefono for t in threads], [t.wa_user_id for t in threads],
    ))
    bumps: list[tuple[str, datetime]] = []
    loose: list[HistoryThread] = []
    for thread in threads:
        contact = _find(contacts, thread.telefono, thread.wa_user_id)
        if contact is None:
            loose.append(thread)
        elif thread.last_message_at:
            bumps.append((str(contact["id"]), thread.last_message_at))
    await repository.bump_last_interaction(bumps)
    if not loose:
        return bool(bumps)
    # Conversaciones con gente que no está guardada en la agenda del celular:
    # también se ofrecen para importar, que es justo lo que más interesa.
    batch_id = await repository.open_whatsapp_batch(create=True)
    rows = _index(await repository.pending_rows_by_identity(
        batch_id, [t.telefono for t in loose], [t.wa_user_id for t in loose],
    ))
    for thread in loose:
        draft = ContactDraft(
            telefono=thread.telefono, wa_user_id=thread.wa_user_id, username=thread.username,
            ultima_interaccion_at=thread.last_message_at,
        )
        await _stage(batch_id, draft, None, rows)
    await repository.touch_batch(batch_id)
    return bool(bumps)


async def apply_history(phone_number_id: str, value: dict) -> None:
    """Webhook ``history``. Guarda cada fragmento tal como llegó (Meta no lo
    vuelve a mandar) y usa sus conversaciones para fechar a cada persona."""
    chunks = history_chunks(value)
    if not chunks:
        return
    async with unit_of_work():
        bumped = False
        for chunk in chunks:
            if chunk.declined:
                await repository.save_sync(phone_number_id, SyncType.HISTORY, {
                    "status": SyncStatus.DECLINED,
                    "error": "El negocio no aceptó compartir el historial al conectar el número",
                })
                continue
            await repository.store_history_chunk(
                phone_number_id, chunk.phase, chunk.chunk_order, chunk.progress, chunk.raw,
            )
            bumped = await _apply_threads(chunk.threads) or bumped
            done = chunk.progress is not None and chunk.progress >= 100
            await repository.save_sync(phone_number_id, SyncType.HISTORY, {
                "status": SyncStatus.DONE if done else SyncStatus.RECEIVING,
                "progress": chunk.progress,
            })
        if bumped:
            collect(ContactsChanged())
        collect(ContactImportsChanged())


async def record_sync_request(
    phone_number_id: str, sync_type: str, *, request_id: str | None, error: str | None,
    window_started_at: datetime | None = None,
) -> None:
    values: dict = {
        "status": SyncStatus.FAILED if error else SyncStatus.REQUESTED,
        "request_id": request_id,
        "error": error,
        "requested_at": _now(),
    }
    if window_started_at is not None:
        values["window_started_at"] = window_started_at
    async with unit_of_work():
        await repository.save_sync(phone_number_id, sync_type, values)
        collect(ContactImportsChanged())


async def syncs_to_retry(phone_number_id: str) -> list[str]:
    """Pedidos que fallaron y todavía están dentro de las 24 h de Meta, en el
    orden en que hay que pedirlos (contactos antes que historial)."""
    pending = []
    for sync_type in (SyncType.CONTACTS, SyncType.HISTORY):
        row = await repository.sync_row(phone_number_id, sync_type)
        if row and row["status"] == SyncStatus.FAILED and _now() < row["window_started_at"] + SYNC_WINDOW:
            pending.append(str(sync_type))
    return pending


async def set_auto_import(enabled: bool) -> None:
    async with unit_of_work():
        await repository.set_auto_import_whatsapp(enabled)
        collect(ContactImportsChanged())

"""Lectura de lo que manda Meta desde la app WhatsApp Business del celular
(coexistencia): los cambios de la agenda (``smb_app_state_sync``) y el
historial de chats (``history``).

Referencia: Embedded Signup > Onboarding WhatsApp Business app users. Los
campos opcionales faltan seguido (``phone_number`` sobre todo): la identidad
segura es el BSUID (``user_id``)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from app.modules.contacts.normalization import clean_text, phone_from_meta

# Meta lo manda en el webhook ``history`` cuando el negocio no aceptó
# compartir el historial al conectar el número.
HISTORY_DECLINED_CODE = 2593109


@dataclass(frozen=True)
class AppContactChange:
    action: str  # "add" (alta o edición) o "remove"
    telefono: str | None
    wa_user_id: str | None
    nombre: str | None
    username: str | None
    changed_at: datetime | None

    @property
    def identified(self) -> bool:
        return bool(self.telefono or self.wa_user_id)


@dataclass(frozen=True)
class HistoryThread:
    telefono: str | None
    wa_user_id: str | None
    username: str | None
    last_message_at: datetime | None


@dataclass(frozen=True)
class HistoryChunk:
    phase: int | None
    chunk_order: int | None
    progress: int | None
    threads: list[HistoryThread]
    declined: bool
    raw: dict


def _dict(value: Any) -> dict:
    return value if isinstance(value, dict) else {}


def _list(value: Any) -> list:
    return value if isinstance(value, list) else []


def _int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _timestamp(value: Any) -> datetime | None:
    seconds = _int(value)
    if seconds is None or seconds <= 0:
        return None
    try:
        return datetime.fromtimestamp(seconds, tz=timezone.utc)
    except (OverflowError, OSError, ValueError):
        return None


def contact_changes(value: dict) -> list[AppContactChange]:
    changes: list[AppContactChange] = []
    for item in _list(value.get("state_sync")):
        item = _dict(item)
        if item.get("type") != "contact" or item.get("action") not in ("add", "remove"):
            continue
        contact = _dict(item.get("contact"))
        change = AppContactChange(
            action=item["action"],
            telefono=phone_from_meta(contact.get("phone_number")),
            wa_user_id=clean_text(contact.get("user_id"), 200),
            nombre=clean_text(contact.get("full_name") or contact.get("first_name"), 200),
            username=clean_text(contact.get("username"), 200),
            changed_at=_timestamp(_dict(item.get("metadata")).get("timestamp")),
        )
        if change.identified:
            changes.append(change)
    # En orden: un alta y una baja del mismo contacto en un mismo envío.
    return sorted(changes, key=lambda change: change.changed_at or datetime.min.replace(tzinfo=timezone.utc))


def _thread(thread: dict) -> HistoryThread | None:
    context = _dict(thread.get("context"))
    telefono = phone_from_meta(thread.get("id") or context.get("wa_id"))
    wa_user_id = clean_text(context.get("user_id"), 200)
    if not wa_user_id:
        # Sin contexto, el BSUID solo aparece en los mensajes que mandó el cliente.
        wa_user_id = next(
            (
                clean_text(message.get("from_user_id"), 200)
                for message in map(_dict, _list(thread.get("messages")))
                if message.get("from_user_id")
            ),
            None,
        )
    if not (telefono or wa_user_id):
        return None
    stamps = [_timestamp(_dict(message).get("timestamp")) for message in _list(thread.get("messages"))]
    return HistoryThread(
        telefono=telefono,
        wa_user_id=wa_user_id,
        username=clean_text(context.get("username"), 200),
        last_message_at=max((stamp for stamp in stamps if stamp), default=None),
    )


def history_chunks(value: dict) -> list[HistoryChunk]:
    chunks: list[HistoryChunk] = []
    for entry in map(_dict, _list(value.get("history"))):
        declined = any(_int(_dict(error).get("code")) == HISTORY_DECLINED_CODE for error in _list(entry.get("errors")))
        metadata = _dict(entry.get("metadata"))
        threads = [thread for thread in map(_thread, map(_dict, _list(entry.get("threads")))) if thread]
        chunks.append(HistoryChunk(
            phase=_int(metadata.get("phase")),
            chunk_order=_int(metadata.get("chunk_order")),
            progress=_int(metadata.get("progress")),
            threads=threads,
            declined=declined,
            raw=entry,
        ))
    return chunks


def without_history_threads(change: dict) -> dict:
    """El ``change`` de ``history`` sin las conversaciones, para lo que queda
    en ``public.webhook_inbox`` los días de retención. Ese inbox es compartido
    por todos los negocios y sin cifrar, y un fragmento de historial trae
    chats enteros de pacientes; lo que hace falta conservar ya quedó en el
    schema del negocio. Se deja cuántas conversaciones traía, para depurar."""
    value = _dict(change.get("value"))
    history = value.get("history")
    if not isinstance(history, list):
        return change
    entries = []
    for entry in history:
        if isinstance(entry, dict) and "threads" in entry:
            entry = {
                **{key: item for key, item in entry.items() if key != "threads"},
                "threads_count": len(_list(entry["threads"])),
            }
        entries.append(entry)
    return {**change, "value": {**value, "history": entries}}

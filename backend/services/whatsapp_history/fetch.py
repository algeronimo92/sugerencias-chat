"""Paginado del historial contra Evolution, saltando lo que ya está en la base."""

import logging
from datetime import datetime

from services.db_service import count_wa_messages, existing_wa_message_ids
from services.evolution_service import HISTORY_PAGE_SIZE, find_chat_messages
from services.whatsapp_history.content import _normalize_record
from services.whatsapp_history.envelope import _as_utc, _extract_records
from services.time_format import iso_utc_micros

logger = logging.getLogger(__name__)


# Tope de llamadas a Evolution por request. Cuando el tramo pedido cae dentro
# de lo que ya está en la base, cada página se descarta entera y hay que
# seguir buscando; sin este techo un chat largo dejaría el request colgado.
MAX_EVOLUTION_CALLS = 10


# Cuántas veces se puede corregir la página inicial estimada antes de aceptar
# lo que haya (ver `_estimate_start_page`).
MAX_PAGE_CORRECTIONS = 3


async def _estimate_start_page(chat_id: str) -> int:
    """Primera página de Evolution que probablemente tenga mensajes nuevos.

    Evolution pagina del más nuevo al más viejo, igual que la base, así que
    las primeras páginas son justo lo que ya está registrado. Se saltean
    tantas páginas como mensajes propios haya, con una de margen para no
    pasarse del límite entre historial y registro.
    """
    db_count = await count_wa_messages(chat_id)
    return max(1, db_count // HISTORY_PAGE_SIZE - 1)


async def fetch_whatsapp_history(
    chat_id: str,
    evolution_page: int | None = None,
    before_ts: datetime | None = None,
) -> dict:
    """Tramo del historial de WhatsApp anterior a `before_ts`.

    `evolution_page` es el cursor opaco que devolvió la llamada anterior; en
    la primera se estima a partir de cuántos mensajes del chat hay en la base.
    """
    boundary = _as_utc(before_ts)

    probing = False
    if evolution_page is not None:
        page = evolution_page
    elif boundary is not None:
        page = await _estimate_start_page(chat_id)
        probing = page > 1
    else:
        page = 1

    collected: list[dict] = []
    corrections = 0
    calls = 0
    exhausted = False

    while calls < MAX_EVOLUTION_CALLS and len(collected) < HISTORY_PAGE_SIZE:
        payload = await find_chat_messages(chat_id, page)
        calls += 1
        records, total_pages, _ = _extract_records(payload)

        normalized = [n for n in (_normalize_record(r) for r in records) if n]

        # La estimación se pasó de largo: la página entera quedó por detrás
        # del límite, así que en el medio pueden haber quedado mensajes sin
        # mostrar. Se retrocede a la mitad y se vuelve a probar.
        if (
            probing
            and normalized
            and corrections < MAX_PAGE_CORRECTIONS
            and all(n["sent_at"] < boundary for n in normalized)
        ):
            previous = page
            page = max(1, page // 2)
            corrections += 1
            if page == previous:
                probing = False
            else:
                continue
        probing = False

        if boundary is not None:
            normalized = [n for n in normalized if n["sent_at"] < boundary]

        if normalized:
            known = await existing_wa_message_ids(
                chat_id, [n["wa_message_id"] for n in normalized]
            )
            collected.extend(n for n in normalized if n["wa_message_id"] not in known)

        if total_pages is not None:
            exhausted = page >= total_pages
        else:
            exhausted = len(records) < HISTORY_PAGE_SIZE

        if exhausted:
            break
        page += 1

    seen: set[str] = set()
    unique: list[dict] = []
    for item in sorted(collected, key=lambda n: (n["sent_at"], n["wa_message_id"])):
        if item["wa_message_id"] in seen:
            continue
        seen.add(item["wa_message_id"])
        unique.append(item)

    return {
        "items": [
            {
                "wa_message_id": n["wa_message_id"],
                "sender": n["sender"],
                "content": n["content"],
                "sent_at": iso_utc_micros(n["sent_at"]),
                "message_type": n["message_type"],
                "payload": n["payload"],
            }
            for n in unique
        ],
        "has_more": not exhausted,
        # Al salir del bucle sin agotar el historial, `page` ya quedó apuntando
        # a la primera página sin leer.
        "next_page": None if exhausted else page,
    }

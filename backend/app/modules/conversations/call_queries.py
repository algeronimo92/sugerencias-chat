"""Lado de lectura de las llamadas de WhatsApp: lo que muestra la pantalla.

Los nombres salen de los contratos públicos de ``auth`` y ``leads``: esta
lectura no une tablas ajenas.
"""

from __future__ import annotations

from app.modules.auth.public import user_names
from app.modules.conversations.application.calls import public_call
from app.modules.conversations.application.ports import conversation_ports
from app.modules.conversations.domain import calls as rules
from app.modules.leads.public import fetch_lead_raw

CHAT_CALLS_LIMIT = 200


async def _with_names(rows: list[dict], *, caller_names: bool) -> list[dict]:
    handlers = await user_names(row.get("handled_by_user_id") for row in rows)
    items = []
    for row in rows:
        item = public_call(row)
        item["handled_by_name"] = handlers.get(row.get("handled_by_user_id"))
        if caller_names:
            lead = await fetch_lead_raw(row["chat_id"])
            item["caller_name"] = (lead or {}).get("nombre") or (lead or {}).get("telefono")
        items.append(item)
    return items


async def ringing_calls(user_id: int) -> list[dict]:
    """Las que suenan ahora para esa persona: no las que ya ignoró."""
    rows = [row for row in await conversation_ports().calls.ringing() if user_id not in (row.get("dismissed_by") or [])]
    return await _with_names(rows, caller_names=True)


async def chat_calls(chat_id: str) -> list[dict]:
    return await _with_names(await conversation_ports().calls.for_chat(chat_id, CHAT_CALLS_LIMIT), caller_names=False)


async def call_offer(call_id: int) -> dict:
    """La oferta de audio, solo mientras suena: después nadie la necesita."""
    row = await conversation_ports().calls.get(call_id)
    if row is None:
        raise rules.CallNotFound()
    if row["status"] != rules.RINGING or not row.get("remote_sdp"):
        raise rules.CallNoLongerRinging()
    return {"call_id": row["id"], "sdp": row["remote_sdp"]}

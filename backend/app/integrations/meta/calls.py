"""Lectura de los eventos de llamadas de Meta (campo ``calls`` del webhook).

Puro: no habla con Graph. Traduce ``value.calls[]`` a lo que entienden los
casos de uso. Formas tomadas de la referencia de Meta del 2026-11-18; lo que
Meta agregue se conserva en el evento crudo.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

USER_INITIATED = "USER_INITIATED"


def _timestamp(value: Any) -> datetime | None:
    try:
        return datetime.fromtimestamp(int(value), tz=timezone.utc)
    except (TypeError, ValueError, OverflowError, OSError):
        return None


def _int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


@dataclass(frozen=True)
class CallEventData:
    wa_call_id: str
    event: str
    user_initiated: bool
    occurred_at: datetime | None
    sdp: str | None
    duration_seconds: int | None
    started_at: datetime | None
    ended_at: datetime | None
    error_code: str | None
    raw: dict


def error_code(call: dict, value_errors: list[Any]) -> str | None:
    """El primer código de error del evento: Meta lo manda en la llamada o al
    lado, en ``value.errors``."""
    for source in (call.get("errors"), value_errors):
        for error in source or []:
            if isinstance(error, dict) and error.get("code") is not None:
                return str(error["code"])
    return None


def parse_call(call: dict, value_errors: list[Any] | None = None) -> CallEventData | None:
    """``None`` si el evento no trae id o tipo: no hay a qué llamada aplicarlo."""
    wa_call_id = call.get("id")
    event = call.get("event")
    if not isinstance(wa_call_id, str) or not wa_call_id or not isinstance(event, str):
        return None
    session = call.get("session") if isinstance(call.get("session"), dict) else {}
    sdp = session.get("sdp") if isinstance(session.get("sdp"), str) else None
    return CallEventData(
        wa_call_id=wa_call_id,
        event=event,
        # Sin ``direction`` se asume del cliente: es lo que manda el panel de
        # pruebas de Meta, y una saliente siempre nace en el CRM.
        user_initiated=call.get("direction", USER_INITIATED) == USER_INITIATED,
        occurred_at=_timestamp(call.get("timestamp")),
        sdp=sdp,
        duration_seconds=_int(call.get("duration")),
        started_at=_timestamp(call.get("start_time")),
        ended_at=_timestamp(call.get("end_time")),
        error_code=error_code(call, value_errors or []),
        raw=call,
    )


def without_sdp(change: dict) -> dict:
    """El ``change`` del inbox sin las ofertas SDP, para no dejarlas guardadas
    los días de retención."""
    value = change.get("value") if isinstance(change.get("value"), dict) else None
    if value is None or not isinstance(value.get("calls"), list):
        return change
    calls = []
    for call in value["calls"]:
        if isinstance(call, dict) and isinstance(call.get("session"), dict):
            call = {**call, "session": {k: v for k, v in call["session"].items() if k != "sdp"}}
        calls.append(call)
    return {**change, "value": {**value, "calls": calls}}

"""Cupo de Meta para cambiar el mensaje de una plantilla aprobada.

Meta admite un cambio cada 24 horas y diez cada 30 días en una plantilla
aprobada (las rechazadas y pausadas no tienen tope). La app no guardaba
cuándo se había enviado cada cambio, así que el segundo intento del día
llegaba hasta Meta, volvía con un error genérico y nada avisaba antes: pasó
el 2026-11-23 con «Desde Instagram», editada 13:12 y rechazada 13:17 y 13:18.

Acá solo se cuentan los cambios hechos desde la app. Uno hecho en WhatsApp
Manager no se ve, así que el rechazo de Meta sigue siendo posible: este
cálculo evita el caso común, no reemplaza a Meta.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

EDIT_COOLDOWN = timedelta(hours=24)
EDIT_WINDOW = timedelta(days=30)
MAX_EDITS_PER_WINDOW = 10


def _parse(value: object) -> datetime | None:
    if isinstance(value, datetime):
        moment = value
    elif isinstance(value, str):
        try:
            moment = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    else:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def edits_in_window(times: object, now: datetime) -> list[datetime]:
    """Los cambios que todavía cuentan para el cupo, del más viejo al más nuevo."""
    if not isinstance(times, list):
        return []
    since = now - EDIT_WINDOW
    return sorted(moment for moment in map(_parse, times) if moment and since < moment <= now)


def next_edit_at(times: object, now: datetime) -> datetime | None:
    """Desde cuándo Meta acepta otro cambio; ``None`` si ya se puede."""
    edits = edits_in_window(times, now)
    if not edits:
        return None
    available = edits[-1] + EDIT_COOLDOWN
    if len(edits) >= MAX_EDITS_PER_WINDOW:
        # El décimo cambio más reciente tiene que salir de la ventana de 30 días.
        available = max(available, edits[-MAX_EDITS_PER_WINDOW] + EDIT_WINDOW)
    return available if available > now else None


def record_edit(times: object, now: datetime) -> list[str]:
    """La lista a guardar tras un cambio aceptado: sin los que ya vencieron."""
    return [moment.isoformat() for moment in [*edits_in_window(times, now), now]]

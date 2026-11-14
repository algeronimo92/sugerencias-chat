"""Comandos de la atribución: guardar el clic de un anuncio y encolar los
eventos de conversión. Corren dentro de la transacción de quien los llama
(el webhook, la cita): si esa transacción se revierte, el evento no existe.

Con la función apagada (``meta_capi_enabled``) no se encola nada: no se
acumula deuda para mandar después, porque a los 7 días Meta la rechazaría
igual. El clic sí se guarda siempre: es la atribución del lead.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from app.db.signals import ring_soon, signal
from app.integrations.meta_webhook import metrics
from app.modules.leads.attribution import events as conversions
from app.modules.leads.attribution import repository
from app.modules.leads.dashboard.currency import business_currency
from app.modules.platform.ports.settings_service import get_effective_many

logger = logging.getLogger(__name__)

ENABLED_KEY = "meta_capi_enabled"
TEST_CODE_KEY = "meta_capi_test_event_code"
DATASET_KEY = "meta_capi_dataset_id"
ACCEPTED_BY_KEY = "meta_capi_accepted_by"
ACCEPTED_AT_KEY = "meta_capi_accepted_at"
CONVERSIONS_SIGNAL = "meta_conversions"


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def conversions_enabled() -> bool:
    return (await get_effective_many((ENABLED_KEY,)))[ENABLED_KEY].strip().lower() == "true"


def wake() -> None:
    """Despierta al worker de envío, también en otro proceso."""
    try:
        ring_soon(CONVERSIONS_SIGNAL)
    except RuntimeError:  # sin loop en curso (un script): el sondeo lo recoge
        pass


async def wait_for_work(timeout: float) -> None:
    await signal(CONVERSIONS_SIGNAL).wait(timeout)


def _text(value: object) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _int(value: object) -> int | None:
    try:
        return int(str(value))
    except (TypeError, ValueError):
        return None


async def _queue(lead_id: str, wsp_ad_id: int, *, event_name: str, event_key: str,
                 event_time: datetime, custom_data: dict | None = None,
                 skip_reason: str | None = None, now: datetime | None = None) -> bool:
    now = now or _now()
    if skip_reason is None and conversions.is_too_old(event_time, now):
        skip_reason = conversions.SKIP_TOO_OLD
    queued = await repository.add_event({
        "lead_id": lead_id, "wsp_ad_id": wsp_ad_id, "event_key": event_key,
        "event_name": event_name, "event_time": event_time, "custom_data": custom_data,
        "status": "skipped" if skip_reason else "pending", "skip_reason": skip_reason,
        "next_attempt_at": now,
    })
    if queued and skip_reason is None:
        wake()
    elif queued:
        metrics.meta_conversions_skipped.labels(reason=skip_reason).inc()
    return queued


async def record_ad_click(
    lead_id: str, referral: object, *, phone: str | None, occurred_at: datetime | None,
) -> bool:
    """El clic del anuncio que trajo el mensaje (``messages[].referral``). Una
    fila por ``ctwa_clid``; si es nueva y el lead todavía no tiene su
    ``LeadSubmitted``, lo encola. Devuelve True si el clic era nuevo."""
    if not isinstance(referral, dict):
        return False
    clid = _text(referral.get("ctwa_clid"))
    if clid is None:
        return False
    occurred_at = occurred_at or _now()
    click_id = await repository.insert_click({
        "lead_id": lead_id,
        "telefono": phone or "",
        "ctwaclid": clid,
        "source_id": _int(referral.get("source_id")),
        "source_url": _text(referral.get("source_url")),
        "thumbnail_url": _text(referral.get("thumbnail_url")) or _text(referral.get("image_url")),
        "mensaje": _text(referral.get("body")),
        "plataforma": "meta",
        "fecha_interaccion": occurred_at,
    })
    if click_id is None:
        return False
    if await conversions_enabled():
        await _queue(
            lead_id, click_id, event_name=conversions.LEAD_SUBMITTED,
            event_key=conversions.lead_submitted_key(lead_id), event_time=occurred_at,
        )
    return True


async def queue_appointment_conversions(
    lead_id: str, *, appointment_id: int, adelanto: float, now: datetime | None = None,
) -> list[str]:
    """La cita del lead: ``QualifiedLead`` la primera vez y ``Purchase`` si
    trae adelanto. Sin clic de anuncio anterior no hay nada que atribuir y no
    se registra nada (no es un error). Devuelve los eventos encolados."""
    now = now or _now()
    if not await conversions_enabled():
        return []
    click_id = await repository.last_click_before(lead_id, now)
    if click_id is None:
        return []
    queued = []
    if await _queue(
        lead_id, click_id, event_name=conversions.QUALIFIED_LEAD,
        event_key=conversions.qualified_lead_key(lead_id), event_time=now, now=now,
    ):
        queued.append(conversions.QUALIFIED_LEAD)
    if adelanto and adelanto > 0:
        currency = await business_currency()
        if await _queue(
            lead_id, click_id, event_name=conversions.PURCHASE,
            event_key=conversions.purchase_key(lead_id, appointment_id), event_time=now, now=now,
            custom_data=conversions.purchase_data(adelanto, currency) if currency else {"value": float(adelanto)},
            skip_reason=None if currency else conversions.SKIP_NO_CURRENCY,
        ):
            queued.append(conversions.PURCHASE)
    return queued

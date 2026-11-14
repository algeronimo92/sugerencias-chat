"""Pasada por negocio que manda a Meta los eventos de conversión pendientes.

Un lote de hasta 1000 eventos en una sola llamada. Meta rechaza la petición
entera si un evento es inválido, y a veces responde 200 con menos
``events_received`` que los mandados: en los dos casos se reintenta de a uno
para aislar al culpable sin castigar al resto.

El cliente de Meta llega por el puerto ``ConversionSender``: este archivo no
importa ``app.integrations.meta.client``.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from decimal import Decimal

from app.db.uow import unit_of_work
from app.integrations.meta_webhook import metrics
from app.modules.auth.ports.account_actions import try_send_operational_alert
from app.modules.leads.application.commands import record_conversion_activity
from app.modules.leads.attribution import events as conversions
from app.modules.leads.attribution import repository
from app.modules.leads.attribution.commands import (
    DATASET_KEY,
    TEST_CODE_KEY,
    conversions_enabled,
    wait_for_work,
)
from app.modules.leads.attribution.ports import ConversionSendError, ConversionSender, conversion_sender
from app.modules.platform.ports.settings_service import get_effective_many, update_settings

logger = logging.getLogger(__name__)

# Respaldo del despertador: una señal perdida no deja eventos esperando más.
POLL_SECONDS = 60.0

EVENT_LABELS = {
    conversions.LEAD_SUBMITTED: "Lead desde un anuncio",
    conversions.QUALIFIED_LEAD: "Lead calificado (primera cita)",
    conversions.PURCHASE: "Compra (adelanto de la cita)",
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _amount(custom_data: dict | None) -> str | None:
    if not custom_data or custom_data.get("value") is None:
        return None
    value = Decimal(str(custom_data["value"])).quantize(Decimal("0.01"))
    return f"{value} {custom_data['currency']}" if custom_data.get("currency") else str(value)


async def _dataset(sender: ConversionSender) -> str:
    """El dataset de la WABA, guardado la primera vez: una consulta por negocio."""
    stored = (await get_effective_many((DATASET_KEY,)))[DATASET_KEY].strip()
    if stored:
        return stored
    dataset_id = await sender.ensure_dataset()
    await update_settings({DATASET_KEY: dataset_id})
    return dataset_id


async def _sent(row: dict, trace_id: str | None, now: datetime) -> None:
    await repository.mark(
        row["id"], status="sent", sent_at=now, meta_trace_id=trace_id,
        attempts=row["attempts"] + 1, last_error=None,
    )
    metrics.meta_conversions_sent.labels(event_name=row["event_name"]).inc()
    await record_conversion_activity(
        row["lead_id"], event=EVENT_LABELS.get(row["event_name"], row["event_name"]),
        amount=_amount(row["custom_data"]),
    )


async def _failed(row: dict, error: str, code: object, now: datetime) -> None:
    await repository.mark(row["id"], status="failed", attempts=row["attempts"] + 1, last_error=error[:1000])
    metrics.meta_conversions_failed.labels(code=str(code)).inc()


async def _retry(row: dict, error: str, now: datetime) -> None:
    attempts = row["attempts"] + 1
    retry_at = conversions.next_attempt(attempts, now)
    if conversions.is_too_old(row["event_time"], retry_at):
        # El próximo intento ya caería fuera de los 7 días que Meta acepta.
        await _failed(row, f"{error} · se agotaron los 7 días que Meta acepta", "expired", now)
        return
    await repository.mark(row["id"], attempts=attempts, next_attempt_at=retry_at, last_error=error[:1000])


async def _alert_token() -> None:
    day = _now().strftime("%Y-%m-%d")
    await try_send_operational_alert(
        event_key=f"meta-capi-token:{day}",
        event_type="meta_capi_token",
        subject="Los eventos de conversión de Meta no se pueden enviar",
        title="Meta rechazó el token para la API de Conversiones",
        message=(
            "El token del negocio está vencido o no tiene el permiso "
            "whatsapp_business_manage_events. Un administrador debe volver a conectar "
            "WhatsApp desde Integraciones para conceder el permiso."
        ),
    )


async def _send(rows: list[dict], sender: ConversionSender, *, dataset_id: str, waba_id: str,
                test_code: str | None, now: datetime) -> None:
    events = [
        conversions.payload(
            event_name=row["event_name"], event_time=row["event_time"], waba_id=waba_id,
            ctwa_clid=row["ctwaclid"], custom_data=row["custom_data"],
        )
        for row in rows
    ]
    try:
        result = await sender.send(dataset_id, events, test_code)
    except ConversionSendError as exc:
        outcome = conversions.classify(status_code=exc.status_code, code=exc.code, subcode=exc.subcode)
        if outcome.kind == "token":
            for row in rows:
                await _failed(row, str(exc), exc.code, now)
            await _alert_token()
        elif outcome.kind == "retry":
            for row in rows:
                await _retry(row, str(exc), now)
        elif len(rows) > 1:
            for row in rows:
                await _send([row], sender, dataset_id=dataset_id, waba_id=waba_id, test_code=test_code, now=now)
        else:
            logger.error("Meta rechazó el evento de conversión %s: %s", rows[0]["id"], exc)
            await _failed(rows[0], str(exc), exc.subcode or exc.code, now)
        return

    received = int(result.get("events_received") or 0)
    trace_id = result.get("fbtrace_id") if isinstance(result.get("fbtrace_id"), str) else None
    if received == len(rows):
        for row in rows:
            await _sent(row, trace_id, now)
    elif len(rows) > 1:
        for row in rows:
            await _send([row], sender, dataset_id=dataset_id, waba_id=waba_id, test_code=test_code, now=now)
    else:
        await _retry(rows[0], "Meta respondió sin recibir el evento (events_received: 0)", now)


async def conversions_tick(*, now: datetime | None = None) -> bool:
    """Devuelve True si tomó un lote lleno: puede quedar más."""
    if not await conversions_enabled():
        return False
    sender = conversion_sender()
    if not await sender.is_configured():
        return False
    now = now or _now()
    # Todo en una transacción: el FOR UPDATE SKIP LOCKED del reclamo dura lo
    # que la pasada, y otro worker no toma las mismas filas.
    async with unit_of_work():
        rows = await repository.claim_due(now, conversions.BATCH_SIZE)
        if not rows:
            return False
        try:
            dataset_id = await _dataset(sender)
            waba_id = await sender.waba_id()
        except ConversionSendError as exc:
            # Sin dataset no se manda nada; los eventos esperan su próximo turno.
            outcome = conversions.classify(status_code=exc.status_code, code=exc.code, subcode=exc.subcode)
            logger.warning("No se pudo obtener el dataset de conversiones: %s", exc)
            if outcome.kind == "token":
                await _alert_token()
            for row in rows:
                await _retry(row, str(exc), now)
            return False
        test_code = (await get_effective_many((TEST_CODE_KEY,)))[TEST_CODE_KEY].strip() or None
        await _send(rows, sender, dataset_id=dataset_id, waba_id=waba_id, test_code=test_code, now=now)
    return len(rows) == conversions.BATCH_SIZE


async def wait_for_conversions_work() -> None:
    await wait_for_work(POLL_SECONDS)

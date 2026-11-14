"""Conversiones de anuncios Click-to-WhatsApp hacia la API de Conversiones
de Meta.

Meta solo sabe que alguien escribió desde un anuncio; no sabe si después
agendó. Con este aviso la campaña aprende qué clics terminan en cita y
optimiza hacia ellos (y el negocio ve en el Administrador de anuncios cuántas
citas trajo cada anuncio).

1. El webhook registra el clic (``record_ad_click``) en ``wsp_ad`` con su
   ``ctwa_clid``, que Meta manda en el ``referral`` del primer mensaje.
2. Al guardar una cita de ese lead se encola un ``LeadSubmitted``
   (``queue_appointment_conversion``), si el negocio lo activó.
3. El worker lo manda (``send_pending_conversions``) con reintentos.

El cliente de Meta llega inyectado (``send``): este módulo no habla con la
Graph API por su cuenta (ver ``META_ALLOWED`` en ``test_layering``).
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from app.db.models.leads import MetaConversionEvent, WhatsappAdConversion
from app.db.uow import session_scope
from app.modules.leads.dashboard.currency import business_currency
from app.modules.platform.ports.settings_service import get_effective_many

logger = logging.getLogger(__name__)

ConversionSender = Callable[[str, list[dict]], Awaitable[dict]]

# El evento estándar de Meta para "el lead dejó sus datos / pidió la cita".
APPOINTMENT_EVENT = "LeadSubmitted"
# Meta rechaza eventos con event_time de más de 7 días atrás: pasado ese
# plazo reintentar no sirve.
MAX_EVENT_AGE = timedelta(days=7)
MAX_ATTEMPTS = 8
BATCH_SIZE = 20
POLL_SECONDS = 15.0
ENABLED_KEY = "meta_conversions_enabled"
DATASET_KEY = "meta_dataset_id"
WABA_KEY = "meta_waba_id"


def _as_int(value: object) -> int | None:
    try:
        return int(str(value))
    except (TypeError, ValueError):
        return None


def _text(value: object) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


async def record_ad_click(
    lead_id: str, referral: object, *, phone: str | None, at: datetime | None,
) -> bool:
    """Guarda el clic del anuncio del que vino el mensaje. Un mismo
    ``ctwa_clid`` se guarda una sola vez (un reintento del webhook trae el
    mismo). Devuelve True si lo guardó."""
    if not isinstance(referral, dict):
        return False
    clid = _text(referral.get("ctwa_clid"))
    if clid is None:
        return False
    async with session_scope() as session:
        exists = await session.scalar(
            select(WhatsappAdConversion.id).where(WhatsappAdConversion.ctwaclid == clid).limit(1)
        )
        if exists is not None:
            return False
        session.add(WhatsappAdConversion(
            lead_id=lead_id,
            telefono=phone or "",
            ctwaclid=clid,
            source_id=_as_int(referral.get("source_id")),
            mensaje=_text(referral.get("body")),
            source_url=_text(referral.get("source_url")),
            plataforma="whatsapp_ctwa",
            fecha_interaccion=at or datetime.now(timezone.utc),
        ))
        await session.flush()
    return True


async def queue_appointment_conversion(
    *, appointment_id: int, lead_id: str | None, adelanto: float = 0,
    now: datetime | None = None,
) -> bool:
    """Encola el ``LeadSubmitted`` de la cita si el lead llegó por un anuncio
    y el negocio activó la API de Conversiones. Devuelve True si encoló.

    Se usa el último clic del lead: si volvió por otro anuncio, la cita es
    mérito de ese. Uno por clic: una segunda cita del mismo clic no suma."""
    if not lead_id:
        return False
    settings = await get_effective_many((ENABLED_KEY, DATASET_KEY, WABA_KEY))
    if settings[ENABLED_KEY].strip().lower() != "true":
        return False
    dataset_id, waba_id = settings[DATASET_KEY].strip(), settings[WABA_KEY].strip()
    if not (dataset_id and waba_id):
        logger.warning("API de Conversiones activa sin dataset o WABA: no se encola la cita %s", appointment_id)
        return False
    now = now or datetime.now(timezone.utc)
    async with session_scope() as session:
        click = (await session.execute(
            select(WhatsappAdConversion.id, WhatsappAdConversion.ctwaclid)
            .where(WhatsappAdConversion.lead_id == lead_id, WhatsappAdConversion.ctwaclid.isnot(None))
            .order_by(WhatsappAdConversion.fecha_interaccion.desc().nulls_last(), WhatsappAdConversion.id.desc())
            .limit(1)
        )).first()
    if click is None:
        return False
    value = Decimal(str(adelanto)).quantize(Decimal("0.01")) if adelanto and adelanto > 0 else None
    currency = await business_currency() if value is not None else None
    async with session_scope() as session:
        inserted = await session.scalar(
            insert(MetaConversionEvent)
            .values(
                lead_id=lead_id, appointment_id=appointment_id, event_name=APPOINTMENT_EVENT,
                ctwa_clid=click.ctwaclid, dataset_id=dataset_id, waba_id=waba_id,
                event_time=now, value=value if currency else None, currency=currency,
                next_attempt_at=now,
            )
            .on_conflict_do_nothing(index_elements=["ctwa_clid", "event_name"])
            .returning(MetaConversionEvent.id)
        )
        if inserted is not None:
            click_row = await session.get(WhatsappAdConversion, click.id)
            if click_row is not None:
                click_row.procesado = True
            await session.flush()
    return inserted is not None


def event_payload(event: MetaConversionEvent) -> dict:
    """El evento como lo pide la API de Conversiones para mensajería."""
    payload: dict = {
        "event_name": event.event_name,
        "event_time": int(event.event_time.timestamp()),
        # Meta deduplica por event_id: un reintento que sí había llegado no
        # cuenta dos veces.
        "event_id": f"cliniventas-{event.id}",
        "action_source": "business_messaging",
        "messaging_channel": "whatsapp",
        "user_data": {
            "whatsapp_business_account_id": event.waba_id,
            "ctwa_clid": event.ctwa_clid,
        },
    }
    if event.value is not None and event.currency:
        payload["custom_data"] = {"currency": event.currency, "value": float(event.value)}
    return payload


def _backoff(attempts: int) -> timedelta:
    """1, 2, 4… minutos, con techo de una hora."""
    return timedelta(minutes=min(2 ** max(attempts - 1, 0), 60))


async def send_pending_conversions(send: ConversionSender, *, now: datetime | None = None) -> bool:
    """Una pasada del worker: manda los eventos pendientes que ya tocan.
    Devuelve True si tomó un lote lleno (puede quedar más)."""
    now = now or datetime.now(timezone.utc)
    async with session_scope() as session:
        events = list((await session.scalars(
            select(MetaConversionEvent)
            .where(MetaConversionEvent.status == "pending", MetaConversionEvent.next_attempt_at <= now)
            .order_by(MetaConversionEvent.next_attempt_at, MetaConversionEvent.id)
            .limit(BATCH_SIZE)
            # Dos workers (blue-green) no mandan el mismo evento a la vez.
            .with_for_update(skip_locked=True)
        )).all())
        for event in events:
            if now - event.event_time > MAX_EVENT_AGE:
                event.status = "failed"
                event.last_error = "Pasaron más de 7 días desde la cita: Meta ya no acepta el evento"
                continue
            event.attempts += 1
            try:
                result = await send(event.dataset_id, [event_payload(event)])
            except Exception as exc:  # noqa: BLE001 - cualquier fallo se reintenta
                event.last_error = str(exc)[:1000]
                if event.attempts >= MAX_ATTEMPTS:
                    event.status = "failed"
                else:
                    event.next_attempt_at = now + _backoff(event.attempts)
                logger.warning("Meta rechazó el evento de conversión %s: %s", event.id, exc)
                continue
            event.status = "sent"
            event.sent_at = now
            event.last_error = None
            event.fbtrace_id = _text(result.get("fbtrace_id"))
        await session.flush()
    return len(events) == BATCH_SIZE

"""La cita de un lead que llegó por un anuncio se informa a la API de
Conversiones de Meta, contra PostgreSQL real."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4

from sqlalchemy import select

from app.db.models.leads import MetaConversionEvent, WhatsappAdConversion
from app.db.uow import session_scope
from app.modules.leads.ad_conversions import (
    MAX_ATTEMPTS,
    queue_appointment_conversion,
    record_ad_click,
    send_pending_conversions,
)
from app.modules.leads.ad_conversions_queries import conversions_summary
from app.modules.leads.infrastructure.repository import ensure_lead_stub
from app.modules.platform.settings_service import update_settings
from app.tenancy.context import tenant_context
from tests.postgres_fixtures import app_engine, pg_dsn, tenant  # noqa: F401

REFERRAL = {
    "source_type": "ad", "source_id": "120210000000001", "body": "Agenda tu limpieza",
    "source_url": "https://fb.me/anuncio", "ctwa_clid": "ARAkLkA8rmlFeiCktEJQ",
}


async def _enable(dataset_id: str = "DATASET") -> None:
    await update_settings({
        "meta_conversions_enabled": "true", "meta_dataset_id": dataset_id, "meta_waba_id": "WABA",
    })


async def _lead_with_click(clid: str = REFERRAL["ctwa_clid"]) -> str:
    lead_id = str(uuid4())
    await ensure_lead_stub(lead_id, datetime.now(timezone.utc), None)
    assert await record_ad_click(
        lead_id, {**REFERRAL, "ctwa_clid": clid}, phone="51999888777",
        at=datetime.now(timezone.utc),
    )
    return lead_id


async def _events() -> list[MetaConversionEvent]:
    async with session_scope() as session:
        return list((await session.scalars(select(MetaConversionEvent).order_by(MetaConversionEvent.id))).all())


async def test_a_click_is_recorded_once(tenant):
    with tenant_context(tenant):
        lead_id = await _lead_with_click("clid-once")
        # El reintento del webhook trae el mismo clic.
        assert not await record_ad_click(lead_id, {**REFERRAL, "ctwa_clid": "clid-once"}, phone=None, at=None)
        assert not await record_ad_click(lead_id, {"source_type": "ad"}, phone=None, at=None)
        async with session_scope() as session:
            rows = (await session.scalars(
                select(WhatsappAdConversion).where(WhatsappAdConversion.ctwaclid == "clid-once")
            )).all()
    [row] = rows
    assert row.lead_id == lead_id
    assert row.source_id == 120210000000001
    assert row.telefono == "51999888777"


async def test_the_appointment_queues_one_lead_submitted_per_click(tenant):
    with tenant_context(tenant):
        await _enable()
        lead_id = await _lead_with_click("clid-cita")
        assert await queue_appointment_conversion(appointment_id=10, lead_id=lead_id, adelanto=50)
        # Otra cita del mismo clic no es otra conversión.
        assert not await queue_appointment_conversion(appointment_id=11, lead_id=lead_id)
        [event] = [e for e in await _events() if e.ctwa_clid == "clid-cita"]
        async with session_scope() as session:
            click = await session.scalar(
                select(WhatsappAdConversion).where(WhatsappAdConversion.ctwaclid == "clid-cita")
            )
    assert event.event_name == "LeadSubmitted"
    assert event.appointment_id == 10
    assert (event.dataset_id, event.waba_id, event.status) == ("DATASET", "WABA", "pending")
    assert click.procesado is True


async def test_nothing_is_queued_without_an_ad_or_while_disabled(tenant):
    with tenant_context(tenant):
        await _enable()
        organic = str(uuid4())
        await ensure_lead_stub(organic, datetime.now(timezone.utc), None)
        assert not await queue_appointment_conversion(appointment_id=20, lead_id=organic)
        assert not await queue_appointment_conversion(appointment_id=21, lead_id=None)

        await update_settings({"meta_conversions_enabled": "false"})
        lead_id = await _lead_with_click("clid-pausado")
        assert not await queue_appointment_conversion(appointment_id=22, lead_id=lead_id)


async def test_the_worker_sends_and_records_the_result(tenant):
    sent: list[tuple[str, list[dict]]] = []

    async def send(dataset_id: str, events: list[dict]) -> dict:
        sent.append((dataset_id, events))
        return {"events_received": 1, "fbtrace_id": "TRACE"}

    with tenant_context(tenant):
        await _enable()
        lead_id = await _lead_with_click("clid-envio")
        await queue_appointment_conversion(appointment_id=30, lead_id=lead_id)
        await send_pending_conversions(send)
        [event] = [e for e in await _events() if e.ctwa_clid == "clid-envio"]
        summary = await conversions_summary()

    [(dataset_id, [payload])] = sent
    assert dataset_id == "DATASET"
    assert payload["event_name"] == "LeadSubmitted"
    assert payload["action_source"] == "business_messaging"
    assert payload["messaging_channel"] == "whatsapp"
    assert payload["user_data"] == {"whatsapp_business_account_id": "WABA", "ctwa_clid": "clid-envio"}
    assert (event.status, event.fbtrace_id, event.attempts) == ("sent", "TRACE", 1)
    assert summary["sent"] >= 1
    assert any(item["appointment_id"] == 30 and item["status"] == "sent" for item in summary["recent"])


async def test_a_rejection_is_retried_later_and_gives_up_after_the_limit(tenant):
    async def reject(_dataset_id: str, _events: list[dict]) -> dict:
        raise RuntimeError("Meta Graph API respondió 400")

    now = datetime.now(timezone.utc)
    with tenant_context(tenant):
        await _enable()
        lead_id = await _lead_with_click("clid-rechazo")
        await queue_appointment_conversion(appointment_id=40, lead_id=lead_id, now=now)
        await send_pending_conversions(reject, now=now)
        [event] = [e for e in await _events() if e.ctwa_clid == "clid-rechazo"]
        assert (event.status, event.attempts) == ("pending", 1)
        assert event.next_attempt_at > now
        assert "400" in event.last_error

        moment = now
        for _ in range(MAX_ATTEMPTS):
            moment += timedelta(hours=1)
            await send_pending_conversions(reject, now=moment)
        [event] = [e for e in await _events() if e.ctwa_clid == "clid-rechazo"]
    assert (event.status, event.attempts) == ("failed", MAX_ATTEMPTS)


async def test_an_event_older_than_seven_days_is_not_sent(tenant):
    calls = []

    async def send(dataset_id: str, events: list[dict]) -> dict:
        calls.append(events)
        return {}

    old = datetime.now(timezone.utc) - timedelta(days=8)
    with tenant_context(tenant):
        await _enable()
        lead_id = await _lead_with_click("clid-viejo")
        await queue_appointment_conversion(appointment_id=50, lead_id=lead_id, now=old)
        await send_pending_conversions(send)
        [event] = [e for e in await _events() if e.ctwa_clid == "clid-viejo"]
    assert calls == []
    assert event.status == "failed"

"""Eventos de conversión a Meta contra PostgreSQL real: el clic repetido, el
último toque, el envío de punta a punta, el borrado con el lead y dos
pasadas concurrentes. Diseño: docs/analisis/14-diseno-api-conversiones-meta-ctwa.md §6."""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.db.models.leads import LeadActivity, MetaConversionEvent, WhatsappAdConversion
from app.db.uow import session_scope, unit_of_work
from app.modules.leads.application.commands import create_lead, delete_lead
from app.modules.leads.attribution import commands, repository, worker
from app.modules.leads.attribution import ports as attribution_ports
from app.modules.leads.domain.lead import Actor
from app.modules.platform.settings_service import get_effective, update_settings
from app.tenancy.context import tenant_context
from tests.postgres_fixtures import app_engine, pg_dsn, tenant  # noqa: F401

SYSTEM = Actor.system()
NOW = datetime.now(timezone.utc).replace(microsecond=0)


def _referral(clid: str) -> dict:
    return {"source_type": "ad", "source_id": "120210000000001", "body": "Agenda tu limpieza", "ctwa_clid": clid}


async def _lead(phone: str = "51999000111") -> str:
    return await create_lead(phone, "Ana", actor=SYSTEM)


async def _enable() -> None:
    await update_settings({"meta_capi_enabled": "true"})


async def _events() -> list[MetaConversionEvent]:
    async with session_scope() as session:
        return list((await session.scalars(select(MetaConversionEvent).order_by(MetaConversionEvent.id))).all())


class FakeSender:
    def __init__(self):
        self.batches: list[tuple[str, list[dict], str | None]] = []
        self.datasets = 0

    async def is_configured(self):
        return True

    async def waba_id(self):
        return "WABA"

    async def ensure_dataset(self):
        self.datasets += 1
        return "DATASET"

    async def send(self, dataset_id, events, test_event_code):
        self.batches.append((dataset_id, events, test_event_code))
        return {"events_received": len(events), "fbtrace_id": "TRACE"}


@pytest.fixture
def sender(monkeypatch):
    fake = FakeSender()
    monkeypatch.setattr(attribution_ports, "_sender", fake)
    return fake


async def test_a_repeated_click_is_stored_once_and_lead_submitted_queued_once(tenant):
    with tenant_context(tenant):
        await _enable()
        lead_id = await _lead()
        assert await commands.record_ad_click(lead_id, _referral("clid-1"), phone="51999000111", occurred_at=NOW)
        # El reintento del webhook trae el mismo clic.
        assert not await commands.record_ad_click(lead_id, _referral("clid-1"), phone="51999000111", occurred_at=NOW)
        # Otro anuncio del mismo cliente: clic nuevo, pero el lead entró una sola vez.
        assert await commands.record_ad_click(lead_id, _referral("clid-2"), phone="51999000111", occurred_at=NOW)
        async with session_scope() as session:
            clicks = (await session.scalars(select(WhatsappAdConversion.ctwaclid).order_by(WhatsappAdConversion.id))).all()
        [event] = await _events()
    assert clicks == ["clid-1", "clid-2"]
    assert (event.event_name, event.event_key, event.status) == ("LeadSubmitted", f"{lead_id}:LeadSubmitted", "pending")


async def test_clicks_n8n_already_duplicated_do_not_break_the_capture(tenant):
    """n8n (SUB - save CTWA) guardó el mismo clic dos veces con datos
    distintos: por eso no hay índice único y el despliegue del 2026-11-14
    falló al crearlo. La captura nativa lo encuentra y no agrega otra fila."""
    with tenant_context(tenant):
        await _enable()
        lead_id = await _lead()
        async with session_scope() as session:
            session.add_all([
                WhatsappAdConversion(lead_id=lead_id, telefono="51999000111", ctwaclid="clid-n8n", nombre="Ana"),
                WhatsappAdConversion(lead_id=lead_id, telefono="51999000111", ctwaclid="clid-n8n", valor_venta=120),
            ])
        assert not await commands.record_ad_click(lead_id, _referral("clid-n8n"), phone=None, occurred_at=NOW)
        async with session_scope() as session:
            copies = (await session.scalars(
                select(WhatsappAdConversion.id).where(WhatsappAdConversion.ctwaclid == "clid-n8n")
            )).all()
    assert len(copies) == 2


async def test_with_the_function_off_the_click_is_kept_but_nothing_is_queued(tenant):
    with tenant_context(tenant):
        lead_id = await _lead()
        assert await commands.record_ad_click(lead_id, _referral("clid-off"), phone=None, occurred_at=NOW)
        assert await commands.queue_appointment_conversions(lead_id, appointment_id=1, adelanto=50) == []
        assert await _events() == []


async def test_the_appointment_is_attributed_to_the_last_click_before_it(tenant):
    with tenant_context(tenant):
        await _enable()
        lead_id = await _lead()
        await commands.record_ad_click(lead_id, _referral("primero"), phone=None, occurred_at=NOW - timedelta(days=3))
        await commands.record_ad_click(lead_id, _referral("segundo"), phone=None, occurred_at=NOW - timedelta(days=1))
        await commands.record_ad_click(lead_id, _referral("despues"), phone=None, occurred_at=NOW + timedelta(hours=1))

        assert await commands.queue_appointment_conversions(lead_id, appointment_id=7, adelanto=0, now=NOW) == ["QualifiedLead"]
        # La segunda cita ya no es la primera: no hay otro QualifiedLead.
        assert await commands.queue_appointment_conversions(lead_id, appointment_id=8, adelanto=0, now=NOW) == []
        async with session_scope() as session:
            clid = await session.scalar(
                select(WhatsappAdConversion.ctwaclid)
                .join(MetaConversionEvent, MetaConversionEvent.wsp_ad_id == WhatsappAdConversion.id)
                .where(MetaConversionEvent.event_name == "QualifiedLead")
            )
    assert clid == "segundo"


async def test_the_worker_sends_records_the_trace_and_leaves_it_in_the_history(tenant, sender):
    with tenant_context(tenant):
        await _enable()
        await update_settings({"meta_capi_test_event_code": "TEST123"})
        lead_id = await _lead()
        await commands.record_ad_click(lead_id, _referral("clid-envio"), phone=None, occurred_at=NOW)

        await worker.conversions_tick()
        await worker.conversions_tick()  # sin pendientes: no vuelve a pedir el dataset ni a mandar

        [event] = await _events()
        dataset = await get_effective("meta_capi_dataset_id")
        async with session_scope() as session:
            history = (await session.scalars(
                select(LeadActivity.new_value).where(
                    LeadActivity.lead_id == lead_id, LeadActivity.event_type == "meta_conversion_sent",
                )
            )).all()

    [(dataset_id, [payload], test_code)] = sender.batches
    assert (dataset_id, test_code, sender.datasets, dataset) == ("DATASET", "TEST123", 1, "DATASET")
    assert payload["user_data"] == {"whatsapp_business_account_id": "WABA", "ctwa_clid": "clid-envio"}
    assert (event.status, event.meta_trace_id, event.attempts) == ("sent", "TRACE", 1)
    assert history == [{"evento": "Lead desde un anuncio"}]


async def test_deleting_the_lead_takes_its_events_with_it(tenant):
    with tenant_context(tenant):
        await _enable()
        lead_id = await _lead()
        await commands.record_ad_click(lead_id, _referral("clid-borrado"), phone=None, occurred_at=NOW)
        assert len(await _events()) == 1

        await delete_lead(lead_id, actor=SYSTEM)

        assert await _events() == []


async def test_two_concurrent_passes_never_claim_the_same_event(tenant):
    with tenant_context(tenant):
        await _enable()
        lead_id = await _lead()
        await commands.record_ad_click(lead_id, _referral("clid-concurrente"), phone=None, occurred_at=NOW)

        first_claimed = asyncio.Event()
        release = asyncio.Event()

        async def first() -> list[dict]:
            async with unit_of_work():
                rows = await repository.claim_due(datetime.now(timezone.utc), 10)
                first_claimed.set()
                await release.wait()
                return rows

        async def second() -> list[dict]:
            await first_claimed.wait()
            async with unit_of_work():
                rows = await repository.claim_due(datetime.now(timezone.utc), 10)
            release.set()
            return rows

        claimed_first, claimed_second = await asyncio.gather(first(), second())

    assert len(claimed_first) == 1
    assert claimed_second == []

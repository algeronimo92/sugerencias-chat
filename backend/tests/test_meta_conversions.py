"""El evento de conversión que se manda a Meta y quién lo dispara."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal

from app.db.models.leads import MetaConversionEvent
from app.modules.appointments.domain.events import AppointmentCreated
from app.modules.leads import ad_conversions, subscribers
from app.modules.leads.ad_conversions import _backoff, event_payload


def _event(**values) -> MetaConversionEvent:
    return MetaConversionEvent(
        id=7, event_name="LeadSubmitted", ctwa_clid="CLID", dataset_id="D", waba_id="W",
        event_time=datetime(2026, 11, 13, 15, 0, tzinfo=timezone.utc), **values,
    )


def test_the_payload_attributes_the_appointment_to_the_ad_click():
    assert event_payload(_event()) == {
        "event_name": "LeadSubmitted",
        "event_time": 1794582000,
        "event_id": "cliniventas-7",
        "action_source": "business_messaging",
        "messaging_channel": "whatsapp",
        "user_data": {"whatsapp_business_account_id": "W", "ctwa_clid": "CLID"},
    }


def test_the_deposit_travels_as_value_only_with_a_currency():
    assert event_payload(_event(value=Decimal("50.00"), currency="PEN"))["custom_data"] == {
        "currency": "PEN", "value": 50.0,
    }
    assert "custom_data" not in event_payload(_event(value=Decimal("50.00"), currency=None))


def test_retries_back_off_up_to_an_hour():
    assert [_backoff(n) for n in (1, 2, 3)] == [timedelta(minutes=1), timedelta(minutes=2), timedelta(minutes=4)]
    assert _backoff(20) == timedelta(hours=1)


async def test_the_saved_appointment_queues_its_conversion(monkeypatch):
    calls = []

    async def queue(**values):
        calls.append(values)
        return True

    monkeypatch.setattr(subscribers, "queue_appointment_conversion", queue)
    await subscribers.report_appointment_conversion(AppointmentCreated(
        appointment_id=3, created_by_user_id=1, seller_name="Ana", title="t", text="x",
        lead_id="lead-1", adelanto=80,
    ))
    assert calls == [{"appointment_id": 3, "lead_id": "lead-1", "adelanto": 80}]


async def test_a_failure_to_queue_never_breaks_the_appointment(monkeypatch):
    async def broken(**_values):
        raise RuntimeError("base caída")

    monkeypatch.setattr(subscribers, "queue_appointment_conversion", broken)
    await subscribers.report_appointment_conversion(AppointmentCreated(
        appointment_id=4, created_by_user_id=1, seller_name="Ana", title="t", text="x", lead_id="lead-1",
    ))


async def test_without_a_lead_nothing_is_queued():
    assert not await ad_conversions.queue_appointment_conversion(appointment_id=5, lead_id=None)
